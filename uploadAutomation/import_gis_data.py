#!/usr/bin/env python3
"""
ELEMENT — GIS Plantation Sites Bulk Import
--------------------------------------------
One-time automation script. Reads the department's Excel sheet
(District/Sub-Division/Range/Beat/JFMC/Area/KML link data), downloads
each linked KML file from Google Drive, and inserts everything into
the gis_sites / gis_kml_files tables — mirroring exactly what the
admin panel's "Add GIS Site" + "Upload KML" actions would produce.

USAGE
-----
  # 1. Dry run first — parses the Excel and shows what WOULD be imported,
  #    does not touch the DB or download any files.
  python3 import_gis_data.py --excel /path/to/file.xlsx --dry-run

  # 2. Test on a small batch first (e.g. first 5 valid rows)
  python3 import_gis_data.py --excel /path/to/file.xlsx --limit 5

  # 3. Full run once the small batch looks correct
  python3 import_gis_data.py --excel /path/to/file.xlsx

  # 4. Skip files already downloaded on a re-run (safe to re-run;
  #    already-downloaded KMLs are not re-fetched)
  #    (this is the default behavior, no flag needed)

REQUIREMENTS
------------
  pip install pandas openpyxl requests psycopg2-binary python-dotenv

CONFIG
------
  Reads DATABASE_URL from the backend's .env file (path set via
  --env-file, defaults to ../.env relative to this script — i.e.
  backend/.env if this script sits in backend/uploadAutomation/).

  Reads UPLOAD_DIR from the same .env (defaults to ./uploads if unset),
  and writes KML files into <UPLOAD_DIR>/gis/ — the exact same folder
  the app's multer upload middleware uses, so files are served
  correctly by Nginx's /uploads alias with zero further steps.

OUTPUT
------
  - logs/import_report_<timestamp>.txt   — full run summary
  - logs/skipped_rows_<timestamp>.csv    — every skipped row + reason
  - logs/imported_rows_<timestamp>.csv   — every successfully imported row
"""

import argparse
import csv
import os
import re
import sys
import uuid
from datetime import datetime
from pathlib import Path
from urllib.parse import urlparse, parse_qs

import openpyxl
import requests

try:
    import psycopg2
    import psycopg2.extras
except ImportError:
    psycopg2 = None


# ─────────────────────────────────────────────────────────────────
# Constants
# ─────────────────────────────────────────────────────────────────

VALID_DISTRICTS = {
    "West Tripura", "Sepahijala", "Khowai", "Gomati",
    "South Tripura", "Dhalai", "Unakoti", "North Tripura",
}

# District names as they might appear in the Excel -> canonical DB value.
# The Excel uses regional/administrative names (e.g. "North") that don't
# always match the app's 8-district list. This map handles that.
DISTRICT_NORMALIZE = {
    "north": "North Tripura",
    "south": "South Tripura",
    "west": "West Tripura",
    "sepahijala": "Sepahijala",
    "khowai": "Khowai",
    "gomati": "Gomati",
    "dhalai": "Dhalai",
    "unakoti": "Unakoti",
    "north tripura": "North Tripura",
    "south tripura": "South Tripura",
    "west tripura": "West Tripura",
}

SUBTOTAL_MARKERS = ("sub-total", "subtotal", "total", "grand total")

SHEET_NAME = "KMLs"

HEADER_ROW = 1
FIRST_DATA_ROW = 2

COL = {
    "sl_no": "A",
    "district": "B",
    "sub_division": "C",
    "range": "D",
    "beat": "E",
    "jfmc_name": "F",
    "area_sanction": "G",
    "area_kobo": "H",
    "kml": "I",
    "remarks": "J",
    "overlapping_area": "K",
}


# ─────────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────────

def slugify_filename(name: str) -> str:
    """Mirror the backend's sanitization: keep [a-zA-Z0-9._- ], fallback."""
    if not name:
        return "kml-file.kml"
    cleaned = re.sub(r"[^a-zA-Z0-9._\- ]", "", name).strip()
    if not cleaned:
        return "kml-file.kml"
    if not cleaned.lower().endswith(".kml"):
        cleaned += ".kml"
    return cleaned


def build_stored_filename(original_name: str) -> str:
    """Mirror buildFilename(): <uuid>-<sanitized-lowercase-basename>.kml"""
    base = slugify_filename(original_name)
    stem, ext = os.path.splitext(base)
    stem = re.sub(r"[^a-zA-Z0-9._-]", "-", stem.lower()).strip("-") or "kml-file"
    return f"{uuid.uuid4()}-{stem}{ext.lower() or '.kml'}"


def extract_drive_file_id(url: str) -> str | None:
    """Extract the file ID from a Google Drive share link."""
    if not url:
        return None
    m = re.search(r"/file/d/([a-zA-Z0-9_-]+)", url)
    if m:
        return m.group(1)
    parsed = urlparse(url)
    qs = parse_qs(parsed.query)
    if "id" in qs:
        return qs["id"][0]
    return None


def download_drive_file(file_id: str, dest_path: Path, session: requests.Session) -> tuple[bool, str]:
    """
    Download a Google Drive file shared as 'anyone with link'.
    Handles the large-file virus-scan confirmation page automatically.
    Returns (success, error_message).
    """
    base_url = "https://drive.google.com/uc?export=download"
    try:
        resp = session.get(base_url, params={"id": file_id}, stream=True, timeout=30)
    except requests.RequestException as e:
        return False, f"request failed: {e}"

    if resp.status_code != 200:
        return False, f"HTTP {resp.status_code}"

    # Detect the "can't scan this file for viruses" confirmation page
    # (happens for larger files even when small confirmations aren't
    # usually needed for tiny KMLs, but we handle it defensively).
    content_type = resp.headers.get("Content-Type", "")
    if "text/html" in content_type:
        token = None
        for key, value in resp.cookies.items():
            if key.startswith("download_warning"):
                token = value
                break
        if not token:
            m = re.search(r'confirm=([0-9A-Za-z_]+)', resp.text)
            if m:
                token = m.group(1)
        if token:
            try:
                resp = session.get(
                    base_url,
                    params={"id": file_id, "confirm": token},
                    stream=True,
                    timeout=30,
                )
            except requests.RequestException as e:
                return False, f"confirm-request failed: {e}"
        else:
            return False, "got HTML page, no confirm token found (file may be private/inaccessible)"

    if resp.status_code != 200:
        return False, f"HTTP {resp.status_code} on final download"

    try:
        with open(dest_path, "wb") as f:
            for chunk in resp.iter_content(chunk_size=8192):
                if chunk:
                    f.write(chunk)
    except OSError as e:
        return False, f"write failed: {e}"

    if dest_path.stat().st_size == 0:
        dest_path.unlink(missing_ok=True)
        return False, "downloaded file is empty (0 bytes) — link likely inaccessible"

    return True, ""


def normalize_district(raw: str) -> str | None:
    if not raw:
        return None
    key = raw.strip().lower()
    return DISTRICT_NORMALIZE.get(key)


def to_number(val):
    if val is None:
        return None
    if isinstance(val, (int, float)):
        return float(val)
    s = str(val).strip()
    try:
        return float(s)
    except ValueError:
        return None


def is_subtotal_row(sub_division_val, range_val) -> bool:
    for v in (sub_division_val, range_val):
        if v and any(marker in str(v).strip().lower() for marker in SUBTOTAL_MARKERS):
            return True
    return False


# ─────────────────────────────────────────────────────────────────
# Excel parsing
# ─────────────────────────────────────────────────────────────────

def parse_excel(excel_path: str):
    """
    Returns (valid_rows, skipped_rows)
    valid_rows: list of dicts ready for DB insert + a drive_file_id + kml_original_name
    skipped_rows: list of dicts with a 'reason' field, for the report
    """
    wb = openpyxl.load_workbook(excel_path, data_only=False)
    ws = wb[SHEET_NAME]

    valid_rows = []
    skipped_rows = []

    # running "last seen" values for forward-fill across merged cells
    last = {"district": None, "sub_division": None, "range": None, "beat": None}

    for row_idx in range(FIRST_DATA_ROW, ws.max_row + 1):
        def cell(col_letter):
            return ws[f"{col_letter}{row_idx}"]

        sl_no_cell = cell(COL["sl_no"])
        district_cell = cell(COL["district"])
        sub_div_cell = cell(COL["sub_division"])
        range_cell = cell(COL["range"])
        beat_cell = cell(COL["beat"])
        jfmc_cell = cell(COL["jfmc_name"])
        area_sanction_cell = cell(COL["area_sanction"])
        area_kobo_cell = cell(COL["area_kobo"])
        kml_cell = cell(COL["kml"])
        remarks_cell = cell(COL["remarks"])
        overlap_cell = cell(COL["overlapping_area"])

        # forward-fill merged-cell columns
        if district_cell.value not in (None, ""):
            last["district"] = district_cell.value
        if sub_div_cell.value not in (None, ""):
            last["sub_division"] = sub_div_cell.value
        if range_cell.value not in (None, ""):
            last["range"] = range_cell.value
        if beat_cell.value not in (None, ""):
            last["beat"] = beat_cell.value

        raw_district = last["district"]
        raw_sub_division = last["sub_division"]
        raw_range = last["range"]
        raw_beat = last["beat"]

        # skip fully blank rows
        if all(
            v in (None, "")
            for v in [sl_no_cell.value, jfmc_cell.value, kml_cell.value]
        ):
            continue

        # skip subtotal/total rows (these show up as text in sub_division
        # or range columns, e.g. "Sub-total of ANR", "District ANR Total")
        if is_subtotal_row(sub_div_cell.value, range_cell.value):
            continue

        row_report = {
            "row_number": row_idx,
            "sl_no": sl_no_cell.value,
            "district_raw": raw_district,
            "jfmc_name": jfmc_cell.value,
        }

        # sl_no missing usually means it's a subtotal/blank row we didn't
        # catch above — treat as non-data row, skip silently (not reported
        # as an error, just not a real site row)
        if sl_no_cell.value in (None, ""):
            continue

        district = normalize_district(raw_district)
        jfmc_name = (jfmc_cell.value or "").strip() if jfmc_cell.value else None
        area_sanction = to_number(area_sanction_cell.value)
        area_kobo = to_number(area_kobo_cell.value)
        drive_url = kml_cell.hyperlink.target if kml_cell.hyperlink else None
        kml_original_name = (kml_cell.value or "").strip() if kml_cell.value else None

        missing = []
        if not district:
            missing.append(f"district (raw value: {raw_district!r} not recognized)")
        if not raw_range:
            missing.append("range")
        if not raw_beat:
            missing.append("beat")
        if not jfmc_name:
            missing.append("jfmc_name")
        if area_sanction is None:
            missing.append(f"area_sanction (raw: {area_sanction_cell.value!r})")
        if area_kobo is None:
            missing.append(f"area_kobo (raw: {area_kobo_cell.value!r})")
        if not drive_url:
            missing.append("kml_drive_link")

        if missing:
            row_report["reason"] = "missing: " + ", ".join(missing)
            skipped_rows.append(row_report)
            continue

        drive_file_id = extract_drive_file_id(drive_url)
        if not drive_file_id:
            row_report["reason"] = f"could not extract Drive file ID from URL: {drive_url}"
            skipped_rows.append(row_report)
            continue

        valid_rows.append({
            "row_number": row_idx,
            "sl_no": int(sl_no_cell.value) if str(sl_no_cell.value).strip().isdigit() else None,
            "district": district,
            "sub_division": (raw_sub_division or "").strip() or None,
            "range": raw_range.strip(),
            "beat": raw_beat.strip(),
            "jfmc_name": jfmc_name,
            "area_sanction": area_sanction,
            "area_kobo": area_kobo,
            "remarks": (remarks_cell.value or "").strip() or None if remarks_cell.value else None,
            "overlapping_area": (overlap_cell.value or "").strip() or None if overlap_cell.value else None,
            "drive_file_id": drive_file_id,
            "kml_original_name": kml_original_name or f"{drive_file_id}.kml",
        })

    return valid_rows, skipped_rows


# ─────────────────────────────────────────────────────────────────
# .env parsing (tiny, no external dep needed)
# ─────────────────────────────────────────────────────────────────

def read_env_file(path: str) -> dict:
    env = {}
    p = Path(path)
    if not p.exists():
        return env
    for line in p.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        env[k.strip()] = v.strip().strip('"').strip("'")
    return env


# ─────────────────────────────────────────────────────────────────
# Main
# ─────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="Import GIS plantation site data from Excel + Google Drive KMLs")
    parser.add_argument("--excel", required=True, help="Path to the .xlsx file")
    parser.add_argument("--env-file", default="../.env", help="Path to backend .env (default: ../.env)")
    parser.add_argument("--dry-run", action="store_true", help="Parse only, no downloads, no DB writes")
    parser.add_argument("--limit", type=int, default=None, help="Only process the first N valid rows")
    parser.add_argument("--skip-download", action="store_true", help="Skip downloading, only insert DB rows for files already downloaded")
    args = parser.parse_args()

    script_dir = Path(__file__).parent
    downloaded_dir = script_dir / "downloaded_kml"
    logs_dir = script_dir / "logs"
    downloaded_dir.mkdir(exist_ok=True)
    logs_dir.mkdir(exist_ok=True)

    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")

    print(f"Parsing Excel: {args.excel}")
    valid_rows, skipped_rows = parse_excel(args.excel)

    print(f"\nParse results:")
    print(f"  Valid rows (complete data):  {len(valid_rows)}")
    print(f"  Skipped rows (incomplete/subtotal): {len(skipped_rows)}")

    # write skip report
    skip_report_path = logs_dir / f"skipped_rows_{timestamp}.csv"
    with open(skip_report_path, "w", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=["row_number", "sl_no", "district_raw", "jfmc_name", "reason"])
        writer.writeheader()
        for r in skipped_rows:
            writer.writerow(r)
    print(f"  Skip report written to: {skip_report_path}")

    if args.limit:
        valid_rows = valid_rows[:args.limit]
        print(f"  --limit applied: processing only first {len(valid_rows)} valid rows")

    if args.dry_run:
        print("\n--- DRY RUN: sample of first 10 valid rows ---")
        for r in valid_rows[:10]:
            print(f"  Row {r['row_number']}: {r['jfmc_name']} | {r['district']} > {r['sub_division']} > "
                  f"{r['range']} > {r['beat']} | sanction={r['area_sanction']} kobo={r['area_kobo']} | "
                  f"kml={r['kml_original_name']} (drive_id={r['drive_file_id']})")
        print(f"\nDry run complete. {len(valid_rows)} rows would be imported. No files downloaded, no DB writes made.")
        return

    # load .env
    env_path = (script_dir / args.env_file).resolve()
    env = read_env_file(str(env_path))
    database_url = env.get("DATABASE_URL")
    upload_dir = env.get("UPLOAD_DIR", "./uploads")

    if not database_url:
        print(f"\nERROR: DATABASE_URL not found in {env_path}. Aborting.")
        sys.exit(1)

    if psycopg2 is None:
        print("\nERROR: psycopg2 not installed. Run: pip install psycopg2-binary")
        sys.exit(1)

    # resolve backend root (parent of this script's dir) for UPLOAD_DIR
    backend_root = script_dir.parent
    gis_upload_dir = (backend_root / upload_dir.lstrip("./") / "gis").resolve()
    gis_upload_dir.mkdir(parents=True, exist_ok=True)
    print(f"\nKML files will be saved to: {gis_upload_dir}")
    print(f"Connecting to DB via DATABASE_URL from {env_path}")

    conn = psycopg2.connect(database_url)
    conn.autocommit = False

    session = requests.Session()

    imported = []
    failed = []

    for i, row in enumerate(valid_rows, 1):
        print(f"\n[{i}/{len(valid_rows)}] Row {row['row_number']}: {row['jfmc_name']} ({row['district']})")

        stored_filename = build_stored_filename(row["kml_original_name"])
        local_download_path = downloaded_dir / f"{row['drive_file_id']}.kml"
        final_path = gis_upload_dir / stored_filename

        # download (skip if already downloaded in a prior run)
        if not args.skip_download:
            if local_download_path.exists() and local_download_path.stat().st_size > 0:
                print(f"  Already downloaded, reusing: {local_download_path.name}")
            else:
                print(f"  Downloading from Drive (id={row['drive_file_id']})...")
                ok, err = download_drive_file(row["drive_file_id"], local_download_path, session)
                if not ok:
                    print(f"  FAILED to download: {err}")
                    failed.append({**row, "reason": f"download failed: {err}"})
                    continue
                print(f"  Downloaded OK ({local_download_path.stat().st_size} bytes)")
        else:
            if not local_download_path.exists():
                print(f"  SKIPPED (--skip-download set, file not found locally)")
                failed.append({**row, "reason": "skip-download set, no local file found"})
                continue

        # copy into the app's actual uploads/gis folder with the correct filename
        try:
            final_path.write_bytes(local_download_path.read_bytes())
        except OSError as e:
            print(f"  FAILED to place file into uploads/gis: {e}")
            failed.append({**row, "reason": f"file copy failed: {e}"})
            continue

        file_size_kb = round(final_path.stat().st_size / 1024)
        file_path_public = f"/uploads/gis/{stored_filename}"
        file_name_db = slugify_filename(row["kml_original_name"])

        # DB insert — one transaction per row so a single failure doesn't
        # roll back everything already imported
        try:
            with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
                cur.execute(
                    """
                    INSERT INTO gis_sites
                        (sl_no, district, sub_division, range, beat, jfmc_name,
                         area_sanction, area_kobo, remarks, overlapping_area,
                         display_order, is_active)
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, true)
                    RETURNING id
                    """,
                    (
                        row["sl_no"], row["district"], row["sub_division"],
                        row["range"], row["beat"], row["jfmc_name"],
                        row["area_sanction"], row["area_kobo"],
                        row["remarks"], row["overlapping_area"], row["sl_no"] or 0,
                    ),
                )
                site_id = cur.fetchone()["id"]

                cur.execute(
                    """
                    INSERT INTO gis_kml_files
                        (site_id, file_name, file_path, file_size, display_order)
                    VALUES (%s, %s, %s, %s, 0)
                    """,
                    (site_id, file_name_db, file_path_public, file_size_kb),
                )
            conn.commit()
            print(f"  Inserted OK — site_id={site_id}, file_path={file_path_public}")
            imported.append({**row, "site_id": site_id, "file_path": file_path_public})
        except Exception as e:
            conn.rollback()
            print(f"  DB INSERT FAILED: {e}")
            failed.append({**row, "reason": f"db insert failed: {e}"})
            final_path.unlink(missing_ok=True)
            continue

    conn.close()

    # Flush GIS-related Redis cache keys so the app immediately reflects
    # the newly-imported data (this script bypasses the controller, so
    # the app's normal cache-invalidation-on-write never runs otherwise).
    redis_url = env.get("REDIS_URL", "redis://localhost:6379")
    try:
        import redis as redis_lib
        r = redis_lib.from_url(redis_url)
        keys = r.keys("cache:gis:*")
        if keys:
            r.delete(*keys)
            print(f"\nFlushed {len(keys)} Redis cache key(s) matching cache:gis:*")
        else:
            print("\nNo cache:gis:* keys found to flush.")
    except ImportError:
        print("\nNOTE: 'redis' python package not installed — skipping automatic "
              "cache flush. Run manually: redis-cli DEL $(redis-cli KEYS \"cache:gis:*\")")
    except Exception as e:
        print(f"\nWARNING: could not flush Redis cache automatically ({e}). "
              f"Run manually: redis-cli DEL $(redis-cli KEYS \"cache:gis:*\")")
    # write reports
    imported_path = logs_dir / f"imported_rows_{timestamp}.csv"
    with open(imported_path, "w", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=[
            "row_number", "site_id", "sl_no", "district", "jfmc_name", "file_path"
        ])
        writer.writeheader()
        for r in imported:
            writer.writerow({k: r.get(k) for k in writer.fieldnames})

    failed_path = logs_dir / f"failed_rows_{timestamp}.csv"
    with open(failed_path, "w", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=["row_number", "sl_no", "jfmc_name", "district", "reason"])
        writer.writeheader()
        for r in failed:
            writer.writerow({k: r.get(k) for k in writer.fieldnames})

    report_path = logs_dir / f"import_report_{timestamp}.txt"
    with open(report_path, "w") as f:
        f.write(f"ELEMENT GIS Import Report — {timestamp}\n")
        f.write(f"Excel file: {args.excel}\n")
        f.write(f"{'='*60}\n")
        f.write(f"Total valid rows processed: {len(valid_rows)}\n")
        f.write(f"Successfully imported:      {len(imported)}\n")
        f.write(f"Failed:                      {len(failed)}\n")
        f.write(f"Skipped during parse:        {len(skipped_rows)}\n")
        f.write(f"\nSee skipped_rows_{timestamp}.csv, imported_rows_{timestamp}.csv, "
                f"failed_rows_{timestamp}.csv for details.\n")

    print(f"\n{'='*60}")
    print(f"DONE. Imported: {len(imported)}  Failed: {len(failed)}  Skipped-at-parse: {len(skipped_rows)}")
    print(f"Reports written to: {logs_dir}")


if __name__ == "__main__":
    main()