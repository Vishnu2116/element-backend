const jwt = require("jsonwebtoken");
const redis = require("../config/redis");

const auth = async (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res
      .status(401)
      .json({ error: "Missing or malformed Authorization header" });
  }
  const token = authHeader.split(" ")[1];
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET, {
      algorithms: ["HS256"],
    });

    const sessionKey = `session_active:${payload.id}`;
    const currentSessionId = await redis.get(sessionKey);

    if (!currentSessionId) {
      console.warn(
        `Session rejected (inactivity/expired key): admin_id=${payload.id} at ${new Date().toISOString()}`,
      );
      return res.status(401).json({
        error: "Session expired due to inactivity. Please log in again.",
      });
    }
    if (currentSessionId !== payload.sid) {
      console.warn(
        `Session rejected (session_id mismatch): admin_id=${payload.id} token_sid=${payload.sid} redis_sid=${currentSessionId} at ${new Date().toISOString()}`,
      );
      return res.status(401).json({
        error: "Session invalidated — logged in from another location.",
      });
    }
    const isSessionCheck = req.path === "/session-check";
    if (!isSessionCheck) {
      await redis.expire(sessionKey, 15 * 60);
      console.log(
        `Session touched, expiry reset to 15m: admin_id=${payload.id} sid=${payload.sid} at ${new Date().toISOString()}`,
      );
    }

    req.user = payload;
    next();
  } catch (err) {
    console.warn(
      `Session rejected (JWT verify failed): ${err.message} at ${new Date().toISOString()}`,
    );
    return res.status(401).json({ error: "Invalid or expired token" });
  }
};

module.exports = auth;
