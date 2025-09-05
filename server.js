const express = require("express");
const { spawn, execSync } = require("child_process");
const WebSocket = require("ws");

const app = express();

// Statische Dateien ausliefern
app.use(express.static("public"));

// Kameras erkennen
function listCameras() {
    const output = execSync('ffmpeg -list_devices true -f dshow -i dummy 2>&1', { encoding: 'utf8' });
    const lines = output.split("\n");
    const cameras = [];

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (line.includes('(video)')) {
            const matchName = line.match(/"(.+?)"/);
            if (matchName) {
                const camera = { name: matchName[1], alt: null };
                if (i + 1 < lines.length) {
                    const altMatch = lines[i + 1].match(/Alternative name "(.+?)"/);
                    if (altMatch) camera.alt = altMatch[1];
                }
                cameras.push(camera);
            }
        }
    }
    return cameras;
}

// Kameras JSON Endpoint
const cameras = listCameras();
app.get("/cameras", (req, res) => {
    res.json(cameras.map(cam => ({ name: cam.name })));
});

// Express-Server starten
app.listen(3000, () => console.log("HTTP server running on http://localhost:3000"));

// Kamera-Streams per WebSocket
function setupCameraStream(camera, wsPort) {
    let ffmpeg = null;
    const clients = new Set();

    const wss = new WebSocket.Server({ port: wsPort });

    function startFFmpeg() {
        if (ffmpeg) return;
        const input = camera.alt || camera.name;

        ffmpeg = spawn("ffmpeg", [
            "-f", "dshow",
            "-i", `video=${input}`,
            "-vf", "scale=1920:1080",
            "-c:v", "mpeg1video",
            "-b:v", "1000k",
            "-f", "mpegts",
            "-"
        ]);

        ffmpeg.stdout.on("data", chunk => {
            for (const ws of clients) {
                if (ws.readyState === WebSocket.OPEN) ws.send(chunk, { binary: true });
            }
        });

        ffmpeg.stderr.on("data", data => console.error(`[FFmpeg ${camera.name}]`, data.toString()));

        ffmpeg.on("close", code => {
            console.log(`FFmpeg for ${camera.name} exited with code ${code}`);
            ffmpeg = null;
        });
    }

    function stopFFmpeg() {
        if (ffmpeg && clients.size === 0) {
            ffmpeg.kill("SIGINT");
        }
    }

    wss.on("connection", ws => {
        clients.add(ws);
        console.log(`Client connected to camera "${camera.name}"`);
        startFFmpeg();

        ws.on("close", () => {
            clients.delete(ws);
            console.log(`Client disconnected from camera "${camera.name}"`);
            stopFFmpeg();
        });
    });

    console.log(`🎥 Camera "${camera.name}" WebSocket ready on ws://localhost:${wsPort}`);
}

// Kamera-Streams einrichten
cameras.forEach((camera, index) => {
    const wsPort = 8081 + index;
    setupCameraStream(camera, wsPort);
});
