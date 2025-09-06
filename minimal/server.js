const express = require("express");
const { spawn, execSync } = require("child_process");

function listCameras() {
    const output = execSync('ffmpeg -list_devices true -f dshow -i dummy 2>&1', { encoding: 'utf8' });
    const lines = output.split("\n");
    const cameras = [];

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (line.includes("(video)")) {
            const name = line.match(/"(.+?)"/)?.[1];
            const alt = lines[i + 1]?.match(/Alternative name "(.+?)"/)?.[1] || null;
            if (name) cameras.push({ name, alt });
        }
    }
    return cameras;
}

const cameras = listCameras();
const basePort = 8080;

console.log("🎬 Gefundene Kameras:");
cameras.forEach((cam, idx) => {
    const port = basePort + idx;
    console.log(`📷 "${cam.name}" → http://localhost:${port}/`);
});

cameras.forEach(({ name, alt }, i) => {
    const app = express();
    const port = basePort + i;
    const input = alt || name;

    app.get("/", (req, res) => {
        console.log(`👤 Client connected to "${name}"`);
        res.writeHead(200, {
            "Content-Type": "multipart/x-mixed-replace; boundary=frame",
            "Cache-Control": "no-cache",
            "Connection": "close",
            "Pragma": "no-cache",
        });

        const ffmpeg = spawn("ffmpeg", [
            "-f", "dshow",
            "-i", `video=${input}`,
            "-vf", "crop='min(iw,ih)':'min(iw,ih)':'(iw-min(iw,ih))/2':'(ih-min(iw,ih))/2',format=gray",
            "-r", "60",
            "-f", "mjpeg",
            "pipe:1"
        ]);

        ffmpeg.stdout.on("data", chunk => {
            res.write(`--frame\r\nContent-Type: image/jpeg\r\n\r\n`);
            res.write(chunk);
            res.write("\r\n");
        });

        ffmpeg.stderr.on("data", d => console.error(`🎥 [FFmpeg ${name}]`, d.toString()));
        req.on("close", () => {
            console.log(`❌ Client disconnected from "${name}"`);
            ffmpeg.kill("SIGINT");
        });
    });

    app.listen(port, () => {
        console.log(`✅ Camera "${name}" live at http://localhost:${port}/`);
    });
});
