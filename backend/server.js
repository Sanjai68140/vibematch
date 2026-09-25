const express = require('express');
const cors = require('cors');
const http = require('http');
const { Server } = require('socket.io');

const identityRoutes = require('./src/routes/identity');
const quizRoutes = require('./src/routes/quiz');
const matchRoutes = require('./src/routes/match');
const chatRoutes = require('./src/routes/chat');
const yappingRoutes = require('./src/routes/yapping');
const statsRoutes = require('./src/routes/stats');

const { initSocket, broadcastStats } = require('./src/socket');
const { runMatchmakingCycle } = require('./src/matchmaker');
const { getLiveStats } = require('./src/stats');

const app = express();
app.use(cors());
app.use(express.json());

app.get('/api/health', (req, res) => res.json({ ok: true }));

app.use('/api/identity', identityRoutes);
app.use('/api/quiz', quizRoutes);
app.use('/api/match', matchRoutes);
app.use('/api/chat', chatRoutes);
app.use('/api/yapping', yappingRoutes);
app.use('/api/stats', statsRoutes);

// Serve the frontend if it's placed alongside the backend (see README).
const path = require('path');
const fs = require('fs');
const frontendDir = path.join(__dirname, '..', 'frontend');
if (fs.existsSync(frontendDir)) {
  app.use(express.static(frontendDir));
}

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });
initSocket(io);

// Sweep the waiting pool for matches every 3s, and push live stats every 4s.
setInterval(runMatchmakingCycle, 3000);
setInterval(() => broadcastStats(getLiveStats()), 4000);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Anonymous Match backend running on http://localhost:${PORT}`);
});
