const { Router } = require("express");

const router = Router();

router.use("/auth", require("./auth.routes"));
router.use("/", require("./heroSlides.routes"));
router.use("/", require("./homeLeadership.routes"));
router.use("/", require("./homeSocialMedia.routes"));
router.use("/", require("./officials.routes"));
router.use("/", require("./projects.routes"));
router.use("/", require("./activityProjects.routes"));
router.use("/", require("./knowledgeHub.routes"));
router.use("/", require("./media.routes"));
router.use("/", require("./procurements.routes"));
router.use("/", require("./gis.routes"));
router.use("/", require("./settings.routes"));
router.use("/", require("./rti.routes"));
router.use("/", require("./visitor.routes"));
// Disabled: Contact/Feedback forms removed from frontend UI, routes
// no longer needed. Re-enable if forms are restored.
// router.use("/", require("./contact.routes"));
// router.use("/", require("./feedback.routes"));

router.get("/health", (req, res) => res.json({ status: "ok" }));

module.exports = router;
