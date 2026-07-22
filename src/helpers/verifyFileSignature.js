// file-type is ESM-only; use dynamic import from this CommonJS module.
const ALLOWED_MIME_BY_TYPE = {
  image: ['image/jpeg', 'image/png', 'image/webp'],
  pdf: ['application/pdf'],
};

// Confirms a saved upload's actual magic bytes match its claimed type.
// filePath: path to the file already saved to disk by multer.
// expectedType: 'image' | 'pdf'
// Returns true only if the detected signature is in the allowed set for that type.
async function verifyFileSignature(filePath, expectedType) {
  const allowedMimes = ALLOWED_MIME_BY_TYPE[expectedType];
  if (!allowedMimes) {
    throw new Error(`verifyFileSignature: unknown expectedType "${expectedType}"`);
  }

  const { fileTypeFromFile } = await import('file-type');
  const detected = await fileTypeFromFile(filePath);

  return Boolean(detected && allowedMimes.includes(detected.mime));
}

// Convenience for multi-file uploads (req.files arrays): true only if every
// file's actual signature matches expectedType.
async function verifyAllFileSignatures(files, expectedType) {
  for (const file of files) {
    // eslint-disable-next-line no-await-in-loop
    const valid = await verifyFileSignature(file.path, expectedType);
    if (!valid) return false;
  }
  return true;
}

module.exports = { verifyFileSignature, verifyAllFileSignatures };
