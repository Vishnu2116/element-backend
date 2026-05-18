const { createClient } = require('redis');

const client = createClient({
  url: process.env.REDIS_URL,
});

client.on('error', (err) => console.error('Redis client error:', err));
client.on('connect', () => console.log('Redis connected'));

(async () => {
  await client.connect();
})();

module.exports = client;
