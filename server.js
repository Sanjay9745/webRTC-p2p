// server.js
// This is the signaling server that uses WebSockets to connect two peers.

const http = require('http');
const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');

// Create an HTTP server to serve index.html
const server = http.createServer((req, res) => {
    // Serve index.html for /, /index.html, or /ROOMCODE (6 alphanumeric, case-insensitive)
    const roomCodeMatch = /^\/([a-zA-Z0-9]{6})$/.exec(req.url);
    if (
        req.url === '/' ||
        req.url === '/index.html' ||
        roomCodeMatch
    ) {
        let filePath = path.join(__dirname, 'index.html');
        fs.readFile(filePath, (err, data) => {
            if (err) {
                res.writeHead(500, { 'Content-Type': 'text/plain' });
                res.end('500 Internal Server Error');
                return;
            }
            res.writeHead(200, { 'Content-Type': 'text/html' });
            res.end(data);
        });
        return;
    }
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('404 Not Found');
});

// Create a new WebSocket server on top of the HTTP server
const wss = new WebSocket.Server({ server });

// In-memory storage for rooms and their offers/peers.
// In a production environment, you would use a more robust store like Redis.
const rooms = new Map();

console.log('Signaling server started on ws://localhost:8080');
console.log('HTTP server started on http://localhost:8080');

// Handle WebSocket connections
wss.on('connection', ws => {
    console.log('Client connected');

    // Handle messages from clients
    ws.on('message', message => {
        let data;
        try {
            data = JSON.parse(message);
        } catch (e) {
            console.error('Invalid JSON received:', message);
            return;
        }

        switch (data.type) {
            // Case 1: A user wants to create a new room
            case 'create_room':
                handleCreateRoom(ws, data);
                break;

            // Case 2: A user wants to join an existing room
            case 'join_room':
                handleJoinRoom(ws, data);
                break;

            // Case 3: An answer to an offer is received
            case 'answer':
                handleAnswer(ws, data);
                break;

            // Case 4: An ICE candidate is received
            case 'ice_candidate':
                handleIceCandidate(ws, data);
                break;
                
            default:
                console.log('Unknown message type:', data.type);
        }
    });

    // Handle client disconnection
    ws.on('close', () => {
        console.log('Client disconnected');
        // Clean up any rooms this client was part of
        rooms.forEach((room, roomId) => {
            if (room.creator === ws || room.joiner === ws) {
                // Notify the other peer
                const otherPeer = room.creator === ws ? room.joiner : room.creator;
                if (otherPeer && otherPeer.readyState === WebSocket.OPEN) {
                    otherPeer.send(JSON.stringify({ type: 'peer_disconnected' }));
                }
                rooms.delete(roomId);
                console.log(`Room ${roomId} closed.`);
            }
        });
    });
    
    ws.on('error', (error) => {
        console.error('WebSocket error:', error);
    });
});

/**
 * Handles the creation of a new room.
 * Stores the creator's offer and waits for another peer to join.
 * @param {WebSocket} ws The WebSocket connection of the creator.
 * @param {object} data The message data containing the offer and join code.
 */
function handleCreateRoom(ws, data) {
    const { joinCode, offer } = data;
    if (rooms.has(joinCode)) {
        ws.send(JSON.stringify({ type: 'error', message: 'Room already exists.' }));
        return;
    }
    // Store the creator and their offer
    rooms.set(joinCode, { creator: ws, offer: offer, joiner: null });
    ws.joinCode = joinCode; // Associate joinCode with the ws connection
    console.log(`Room created with code: ${joinCode}`);
    ws.send(JSON.stringify({ type: 'room_created', joinCode: joinCode }));
}

/**
 * Handles a peer's request to join a room.
 * Sends the stored offer to the joining peer.
 * @param {WebSocket} ws The WebSocket connection of the joiner.
 * @param {object} data The message data containing the join code.
 */
function handleJoinRoom(ws, data) {
    const { joinCode } = data;
    const room = rooms.get(joinCode);

    if (!room || room.joiner) {
        ws.send(JSON.stringify({ type: 'error', message: 'Room not found or is full.' }));
        return;
    }
    
    // Assign the joiner to the room
    room.joiner = ws;
    ws.joinCode = joinCode;

    console.log(`Peer joined room: ${joinCode}`);

    // Send the creator's offer to the joining peer
    ws.send(JSON.stringify({ type: 'offer', offer: room.offer }));
}

/**
 * Relays the answer from the joining peer to the room creator.
 * @param {WebSocket} ws The WebSocket connection of the joiner.
 * @param {object} data The message data containing the answer.
 */
function handleAnswer(ws, data) {
    const { joinCode, answer } = data;
    const room = rooms.get(joinCode);
    if (room && room.creator) {
        // Forward the answer to the creator of the room
        room.creator.send(JSON.stringify({ type: 'answer', answer: answer }));
        console.log(`Answer relayed to creator in room: ${joinCode}`);
    } else {
        console.log(`Room or creator not found for join code: ${joinCode}`);
    }
}

/**
 * Relays ICE candidates between the two peers in a room.
 * @param {WebSocket} ws The WebSocket connection of the sender.
 * @param {object} data The message data containing the ICE candidate.
 */
function handleIceCandidate(ws, data) {
    const { joinCode, candidate } = data;
    const room = rooms.get(joinCode);

    if (room) {
        // Determine the other peer in the room
        const otherPeer = room.creator === ws ? room.joiner : room.creator;
        if (otherPeer && otherPeer.readyState === WebSocket.OPEN) {
            // Forward the ICE candidate to the other peer
            otherPeer.send(JSON.stringify({ type: 'ice_candidate', candidate: candidate }));
        }
    }
}

// Start the HTTP server
server.listen(8080);
