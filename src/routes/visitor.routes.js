const { Router } = require("express");
const { globalLimiter } = require("../middleware/rateLimiter");
const { track, getCount } = require("../controllers/visitor.controller");

const router = Router();

router.post("/visitor/track", globalLimiter, track);
router.get("/visitor/count", globalLimiter, getCount);

module.exports = router;
