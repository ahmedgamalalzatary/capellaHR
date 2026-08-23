from fastapi import APIRouter
from fastapi.responses import HTMLResponse

router = APIRouter()


@router.get("/", response_class=HTMLResponse)
async def mobile_app():
    return """
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Face ID Attendance App</title>
        <link href="https://cdn.jsdelivr.net/npm/tailwindcss@2.2.19/dist/tailwind.min.css" rel="stylesheet">
    </head>
    <body class="bg-gray-100 font-sans antialiased">
        <div class="max-w-md mx-auto min-h-screen bg-white shadow-xl flex flex-col">
            <!-- Header -->
            <div class="bg-blue-600 text-white p-4 text-center font-bold text-lg shadow flex items-center justify-center space-x-2">
                <span>🛡️</span>
                <span>Face ID Attendance System</span>
            </div>

            <!-- Main Content Area -->
            <div class="p-4 flex-1 flex flex-col space-y-4">

                <!-- Navigation Tabs -->
                <div class="flex rounded-xl bg-gray-200 p-1">
                    <button onclick="switchTab('enroll')" id="tabEnroll" class="flex-1 py-2 text-center rounded-lg font-semibold text-sm bg-white shadow text-blue-600 transition">1. Upload & Enroll</button>
                    <button onclick="switchTab('verify')" id="tabVerify" class="flex-1 py-2 text-center rounded-lg font-semibold text-sm text-gray-600 transition">2. Live Verify</button>
                </div>

                <!-- Enroll Panel (File Upload) -->
                <div id="panelEnroll" class="space-y-3">
                    <div class="bg-blue-50 p-3 rounded-xl border border-blue-200 text-xs text-blue-800">
                        📁 <b>Step 1:</b> Upload a clear photo of an employee to generate and store their facial embedding baseline.
                    </div>
                    <div>
                        <label class="text-xs font-bold text-gray-600 uppercase">Employee ID</label>
                        <input type="text" id="enrollId" value="EMP_001" class="w-full mt-1 p-3 border rounded-xl focus:ring-2 focus:ring-blue-500 outline-none">
                    </div>
                    <div>
                        <label class="text-xs font-bold text-gray-600 uppercase">Select Photo File</label>
                        <input type="file" id="enrollFile" accept="image/*" class="w-full mt-1 p-2 border rounded-xl bg-white text-sm file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-xs file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100">
                    </div>
                    <button onclick="enrollUser()" class="w-full bg-blue-600 text-white py-3 rounded-xl font-bold shadow-lg hover:bg-blue-700 transition">
                        Upload Photo & Enroll
                    </button>
                </div>

                <!-- Verify Panel (Live Camera) -->
                <div id="panelVerify" class="space-y-3 hidden">
                    <div class="bg-green-50 p-3 rounded-xl border border-green-200 text-xs text-green-800">
                        📷 <b>Step 2:</b> Turn on your camera, look live into the lens, and verify against the enrolled embedding.
                    </div>

                    <!-- Live Camera View -->
                    <div class="relative bg-black rounded-2xl overflow-hidden shadow-md">
                        <video id="video" autoplay playsinline class="w-full h-56 object-cover"></video>
                        <button onclick="startCamera()" id="camBtn" class="absolute bottom-4 left-1/2 transform -translate-x-1/2 bg-white text-green-600 px-5 py-2 rounded-full font-bold shadow-lg text-sm transition transform active:scale-95">
                            Turn On Camera
                        </button>
                    </div>

                    <div>
                        <label class="text-xs font-bold text-gray-600 uppercase">Employee ID</label>
                        <input type="text" id="verifyId" value="EMP_001" class="w-full mt-1 p-3 border rounded-xl focus:ring-2 focus:ring-green-500 outline-none">
                    </div>
                    <div>
                        <label class="text-xs font-bold text-gray-600 uppercase">Embedding Status</label>
                        <div id="embeddingStatus" class="text-xs text-red-500 font-medium mt-1">⚠️ No embedding cached. Complete step 1 first!</div>
                    </div>
                    <button onclick="verifyUser()" class="w-full bg-green-600 text-white py-3 rounded-xl font-bold shadow-lg hover:bg-green-700 transition">
                        Scan Live Frames & Verify
                    </button>
                </div>

                <!-- Result Box -->
                <div id="resultBox" class="hidden p-4 rounded-xl text-sm border shadow-sm">
                    <div id="resultTitle" class="font-bold mb-1"></div>
                    <pre id="resultDetails" class="text-xs overflow-x-auto whitespace-pre-wrap font-mono mt-1"></pre>
                </div>
            </div>
        </div>

        <script>
            const video = document.getElementById("video");
            let stream = null;
            let activeEmbedding = null;

            async function startCamera() {
                try {
                    stream = await navigator.mediaDevices.getUserMedia({ 
                        video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 } } 
                    });
                    video.srcObject = stream;
                    document.getElementById("camBtn").style.display = "none";
                } catch (err) {
                    alert("Camera error: " + err.message);
                }
            }

            function switchTab(tab) {
                if(tab === 'enroll') {
                    document.getElementById('panelEnroll').classList.remove('hidden');
                    document.getElementById('panelVerify').classList.add('hidden');
                    document.getElementById('tabEnroll').className = 'flex-1 py-2 text-center rounded-lg font-semibold text-sm bg-white shadow text-blue-600 transition';
                    document.getElementById('tabVerify').className = 'flex-1 py-2 text-center rounded-lg font-semibold text-sm text-gray-600 transition';
                } else {
                    document.getElementById('panelEnroll').classList.add('hidden');
                    document.getElementById('panelVerify').classList.remove('hidden');
                    document.getElementById('tabVerify').className = 'flex-1 py-2 text-center rounded-lg font-semibold text-sm bg-white shadow text-green-600 transition';
                    document.getElementById('tabEnroll').className = 'flex-1 py-2 text-center rounded-lg font-semibold text-sm text-gray-600 transition';
                }
            }

            async function captureFrame() {
                const canvas = document.createElement("canvas");
                canvas.width = video.videoWidth || 640;
                canvas.height = video.videoHeight || 480;
                canvas.getContext("2d").drawImage(video, 0, 0);
                return await new Promise(res => canvas.toBlob(res, "image/png", 0.95));
            }

            function showResult(success, title, data) {
                const box = document.getElementById("resultBox");
                box.classList.remove("hidden", "bg-green-50", "border-green-200", "bg-red-50", "border-red-200");
                box.classList.add(success ? "bg-green-50" : "bg-red-50", success ? "border-green-200" : "border-red-200");

                document.getElementById("resultTitle").textContent = title;
                document.getElementById("resultTitle").className = success ? "font-bold mb-1 text-green-800" : "font-bold mb-1 text-red-800";
                document.getElementById("resultDetails").textContent = JSON.stringify(data, null, 2);
            }

            async function enrollUser() {
                const empId = document.getElementById("enrollId").value;
                const fileInput = document.getElementById("enrollFile");

                if (fileInput.files.length === 0) {
                    return alert("Please select an image file first!");
                }

                const file = fileInput.files[0];
                const formData = new FormData();
                formData.append("employee_id", empId);
                formData.append("file", file);

                showResult(true, "Processing...", { status: "Uploading image and extracting embedding..." });

                try {
                    const res = await fetch("/api/v1/enroll", { method: "POST", body: formData });
                    const data = await res.json();

                    if (data.success) {
                        activeEmbedding = data.embedding;
                        document.getElementById("verifyId").value = empId;
                        document.getElementById("embeddingStatus").textContent = "✓ Embedding stored in memory!";
                        document.getElementById("embeddingStatus").className = "text-xs text-green-600 font-bold mt-1";
                        showResult(true, "✅ Enrollment Successful!", data);
                    } else {
                        showResult(false, "❌ Enrollment Failed", data);
                    }
                } catch (err) {
                    showResult(false, "Network Error", { error: err.message });
                }
            }

            async function verifyUser() {
                if (!stream) return alert("Please turn on the camera in Step 2 first!");
                if (!activeEmbedding) return alert("No embedding found! Please complete Step 1 (Upload & Enroll) first.");

                const empId = document.getElementById("verifyId").value;

                showResult(true, "Processing...", { status: "Capturing 5 live frames for liveness and matching..." });

                const formData = new FormData();
                formData.append("employee_id", empId);
                formData.append("enrolled_embedding", JSON.stringify(activeEmbedding));

                for (let i = 0; i < 5; i++) {
                    const blob = await captureFrame();
                    formData.append("files", blob, `frame_${i}.png`);
                    await new Promise(r => setTimeout(r, 150));
                }

                try {
                    const res = await fetch("/api/v1/verify", { method: "POST", body: formData });
                    const data = await res.json();

                    if (data.success) {
                        showResult(true, "🎉 Verified Successfully!", data);
                    } else {
                        showResult(false, `⚠️ Rejected: ${data.decision.toUpperCase()} (${data.reason})`, data);
                    }
                } catch (err) {
                    showResult(false, "Network Error", { error: err.message });
                }
            }
        </script>
    </body>
    </html>
    """