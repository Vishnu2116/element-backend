const jwt = require("jsonwebtoken");

function generateCaptcha() {
  const a = Math.floor(Math.random() * 8) + 1; // 1-8
  const b = Math.floor(Math.random() * 8) + 1; // 1-8
  const answer = a + b;
  const token = jwt.sign(
    { answer },
    process.env.JWT_SECRET,
    { algorithm: "HS256", expiresIn: "10m" }
  );
  return { question: `${a} + ${b}`, token };
}

function verifyCaptcha(token, userAnswer) {
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET, {
      algorithms: ["HS256"],
    });
    return Number(decoded.answer) === Number(userAnswer);
  } catch {
    return false;
  }
}

module.exports = { generateCaptcha, verifyCaptcha };
