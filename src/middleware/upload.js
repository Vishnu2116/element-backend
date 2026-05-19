const multer = require('multer');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

function buildFilename(originalname) {
  const ext  = path.extname(originalname).toLowerCase();
  const base = path.basename(originalname, ext)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return `${uuidv4()}-${base}${ext}`;
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, process.env.UPLOAD_DIR || './uploads'),
  filename: (req, file, cb) => cb(null, buildFilename(file.originalname)),
});

const IMAGE_MIME = /^image\/(jpeg|png|webp)$/;
const IMAGE_EXT  = /\.(jpe?g|png|webp)$/i;
const PDF_MIME   = /^application\/pdf$/;
const PDF_EXT    = /\.pdf$/i;

function makeError(msg) {
  const err = new Error(msg);
  err.status = 400;
  return err;
}

const imageFilter = (req, file, cb) => {
  if (IMAGE_MIME.test(file.mimetype) && IMAGE_EXT.test(file.originalname)) return cb(null, true);
  cb(makeError('Invalid file type. Allowed: jpeg, jpg, png, webp'));
};

const pdfFilter = (req, file, cb) => {
  if (PDF_MIME.test(file.mimetype) && PDF_EXT.test(file.originalname)) return cb(null, true);
  cb(makeError('Invalid file type. Allowed: pdf'));
};

const combinedFilter = (req, file, cb) => {
  const isImage = IMAGE_MIME.test(file.mimetype) && IMAGE_EXT.test(file.originalname);
  const isPdf   = PDF_MIME.test(file.mimetype)   && PDF_EXT.test(file.originalname);
  if (isImage || isPdf) return cb(null, true);
  cb(makeError('Invalid file type. Allowed: jpeg, jpg, png, webp, pdf'));
};

const imageUpload = multer({ storage, fileFilter: imageFilter,   limits: { fileSize: 5  * 1024 * 1024 } });
const pdfUpload   = multer({ storage, fileFilter: pdfFilter,     limits: { fileSize: 20 * 1024 * 1024 } });
const combined    = multer({ storage, fileFilter: combinedFilter, limits: { fileSize: 20 * 1024 * 1024 } });

function wrap(instance, method) {
  return (...args) => (req, res, next) => {
    instance[method](...args)(req, res, (err) => {
      if (!err) return next();
      return res.status(err.status || 400).json({ error: err.message });
    });
  };
}

const uploadSingle   = wrap(combined,    'single');   // (fieldName)
const uploadMultiple = wrap(combined,    'array');    // (fieldName, maxCount)
const uploadImage    = wrap(imageUpload, 'single');   // (fieldName) — images only, 5 MB
const uploadPdf      = wrap(pdfUpload,   'single');   // (fieldName) — PDF only, 20 MB

// uploadFields — multi-field upload with per-field type enforcement.
// fields: [{ name, maxCount, type }]  where type is 'image' | 'pdf' | 'any'
// Example: uploadFields([{ name:'file', type:'pdf' }, { name:'thumbnail', type:'image' }])
const uploadFields = (fields) => {
  const typeMap = Object.fromEntries(fields.map(f => [f.name, f.type || 'any']));

  const filter = (req, file, cb) => {
    const expected = typeMap[file.fieldname] || 'any';
    if (expected === 'image') {
      if (IMAGE_MIME.test(file.mimetype) && IMAGE_EXT.test(file.originalname)) return cb(null, true);
      return cb(makeError(`"${file.fieldname}" must be an image (jpeg, jpg, png, webp)`));
    }
    if (expected === 'pdf') {
      if (PDF_MIME.test(file.mimetype) && PDF_EXT.test(file.originalname)) return cb(null, true);
      return cb(makeError(`"${file.fieldname}" must be a PDF`));
    }
    const ok = (IMAGE_MIME.test(file.mimetype) && IMAGE_EXT.test(file.originalname)) ||
               (PDF_MIME.test(file.mimetype)   && PDF_EXT.test(file.originalname));
    if (ok) return cb(null, true);
    cb(makeError('Invalid file type'));
  };

  const instance = multer({ storage, fileFilter: filter, limits: { fileSize: 20 * 1024 * 1024 } });
  const multerFields = fields.map(f => ({ name: f.name, maxCount: f.maxCount || 1 }));

  return (req, res, next) => {
    instance.fields(multerFields)(req, res, (err) => {
      if (err) return res.status(err.status || 400).json({ error: err.message });
      next();
    });
  };
};

module.exports = { uploadSingle, uploadMultiple, uploadImage, uploadPdf, uploadFields };
