// Retro Pocket online-play signalling server: a plain PeerJS server.
// It only relays the short connection handshake (offers/answers/ICE candidates) between host and guests;
// the game stream and controller inputs travel directly between the devices (WebRTC), or via your TURN server.
const http = require('http');
const express = require('express');
const { ExpressPeerServer } = require('peer');

const PORT = Number(process.env.PORT || 9000);
const PATH = process.env.PEER_PATH || '/';          // the app expects the server URL to point at this path
const app = express();
app.get('/health', (_req, res) => res.json({ ok: true, service: 'retro-pocket-netplay' }));
app.use((req, res, next) => { res.setHeader('Access-Control-Allow-Origin', '*'); next(); });
const server = http.createServer(app);
const peer = ExpressPeerServer(server, {
  path: '/',
  proxied: process.env.PROXIED !== '0',              // Render/Fly/Railway terminate TLS in front of the app
  allow_discovery: false,                            // nobody can list open rooms
  alive_timeout: 60000,
  key: process.env.PEER_KEY || 'peerjs',
});
app.use(PATH, peer);
peer.on('connection', (c) => console.log('peer +', c.getId()));
peer.on('disconnect', (c) => console.log('peer -', c.getId()));
server.listen(PORT, '0.0.0.0', () => console.log(`Retro Pocket netplay server on :${PORT}${PATH} (health: /health)`));
