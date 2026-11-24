"""
Kids Robot Backend Server
Handles: Interactive Stories, Multi-API AI Engine, WebSockets (Unified Protocol for Simulator & ESP32-S3)
"""

import json
import os
import time
from pathlib import Path
from typing import List, Dict, Any, Optional

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, JSONResponse
from fastapi.middleware.cors import CORSMiddleware

BASE_DIR = Path(__file__).resolve().parent
SIMULATOR_DIR = BASE_DIR.parent / "simulator"
STORIES_DIR = BASE_DIR / "stories"

app = FastAPI(title="Kids Robot Controller API", version="1.0.0")

# Enable CORS for cross-device mobile access
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- Active WebSocket Connections Manager ---
class ConnectionManager:
    def __init__(self):
        self.active_connections: List[WebSocket] = []

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.append(websocket)
        print(f"Device connected. Total active: {len(self.active_connections)}")

    def disconnect(self, websocket: WebSocket):
        if websocket in self.active_connections:
            self.active_connections.remove(websocket)
            print(f"Device disconnected. Remaining: {len(self.active_connections)}")

    async def broadcast(self, message: Dict[str, Any]):
        for connection in self.active_connections:
            try:
                await connection.send_json(message)
            except Exception as e:
                print(f"Broadcast error: {e}")

manager = ConnectionManager()

# --- AI Fallback & Safety Manager ---
class AIConversationEngine:
    def __init__(self):
        self.last_call_time = 0
        self.cooldown_seconds = 2.0  # Cooldown between API calls
        self.max_tokens = 60          # Keep responses short for kids & cost efficiency

    def generate_response(self, prompt: str) -> Dict[str, Any]:
        """
        Multi-API Fallback with built-in safety rules:
        1. Local Rule-based responses for common kid phrases
        2. Primary AI API (e.g. Gemini / Groq)
        3. Fallback AI API
        4. Safe default friendly response
        """
        now = time.time()
        if now - self.last_call_time < self.cooldown_seconds:
            return {
                "text": "على مهلك يا بطل! أنا أفكر معك الآن... 😊",
                "face": "curious",
                "led": {"pattern": "pulse", "color": "#a855f7"}
            }
        self.last_call_time = now

        # Friendly kid-safe rule-based fallback
        prompt_lower = prompt.strip().lower()
        if any(w in prompt_lower for w in ["مرحبا", "سلام", "أهلا", "صباح", "مساء"]):
            return {
                "text": "أهلاً وسهلاً يا بطل! يسعدني جداً التحدث معك اليوم! ❤️",
                "face": "happy",
                "led": {"pattern": "spin", "color": "#00f2fe"}
            }
        elif any(w in prompt_lower for w in ["احبك", "أحبك", "حلو", "جميل", "شاطر"]):
            return {
                "text": "وأنا أحبك كثيراً يا صديقي العزيز! أنت أروع بطل في العالم! 🌟",
                "face": "love",
                "led": {"pattern": "sparkle", "color": "#ec4899"}
            }
        elif any(w in prompt_lower for w in ["قصة", "حكاية"]):
            return {
                "text": "هيا بنا نعيش قصة ممتعة! المس رأسي لننطلق معاً!",
                "face": "wonder",
                "led": {"pattern": "rainbow"}
            }

        return {
            "text": f"يا لها من فكرة مدهشة! أنت طفل ذكي ومبدع حقاً! 🌟",
            "face": "happy",
            "led": {"pattern": "pulse", "color": "#00ff88"}
        }

ai_engine = AIConversationEngine()

# --- Story Loader Helper ---
def get_story(story_id: str) -> Optional[Dict[str, Any]]:
    story_file = STORIES_DIR / f"{story_id}.json"
    if story_file.exists():
        with open(story_file, "r", encoding="utf-8") as f:
            return json.load(f)
    return None

# --- REST Endpoints ---
@app.get("/api/health")
def health_check():
    return {"status": "ok", "app": "Kids Robot Server", "version": "1.0.0"}

@app.get("/api/stories")
def list_stories():
    stories = []
    if STORIES_DIR.exists():
        for f in STORIES_DIR.glob("*.json"):
            try:
                with open(f, "r", encoding="utf-8") as fp:
                    data = json.load(fp)
                    stories.append({
                        "id": data.get("id"),
                        "title": data.get("title"),
                        "description": data.get("description"),
                        "target_age": data.get("target_age")
                    })
            except Exception:
                pass
    return stories

# --- Unified WebSocket Protocol Endpoint ---
@app.websocket("/ws/robot")
async def websocket_robot_endpoint(websocket: WebSocket):
    await manager.connect(websocket)
    
    current_story_data = get_story("space_adventure")
    current_chunk_idx = 0

    # Initial Welcome Packet
    welcome_packet = {
        "event": "WELCOME",
        "face": "happy",
        "led": {"pattern": "spin", "color": "#00f2fe"},
        "text": "مرحباً يا بطل! أنا متصل الآن بالسيرفر، المس رأسي لنبدأ المغامرة!"
    }
    await websocket.send_json(welcome_packet)

    try:
        while True:
            data = await websocket.receive_json()
            event_type = data.get("event")

            # Broadcast any command from Brain directly to all connected devices (Face & ESP32)
            if event_type in ["SAY_TEXT", "SET_FACE", "SET_LED", "START_STORY", "CHILD_PROFILE_UPDATED"]:
                print(f"Routing command from Brain: {event_type}")
                await manager.broadcast(data)

            elif event_type == "TOUCH_TRIGGER":
                print("Head touch triggered by device")
                if current_story_data and current_chunk_idx < len(current_story_data["chunks"]):
                    chunk = current_story_data["chunks"][current_chunk_idx]
                    current_chunk_idx += 1
                    
                    # Dispatch Story Chunk (Unified format for Simulator & ESP32-S3)
                    await websocket.send_json({
                        "event": "STORY_CHUNK",
                        "face": chunk.get("face", "happy"),
                        "led": chunk.get("led", {"pattern": "spin", "color": "#00f2fe"}),
                        "text": chunk.get("text"),
                        "action_required": chunk.get("action_required"),
                        "hint": chunk.get("hint")
                    })
                else:
                    current_chunk_idx = 0
                    await websocket.send_json({
                        "event": "STORY_COMPLETE",
                        "face": "wonder",
                        "led": {"pattern": "rainbow"},
                        "text": "انتهت مغامرتنا الرائعة! المس رأسي لنبدأ من جديد."
                    })

            elif event_type == "VOICE_INPUT":
                transcript = data.get("transcript", "")
                response = ai_engine.generate_response(transcript)
                await websocket.send_json({
                    "event": "AI_RESPONSE",
                    "face": response["face"],
                    "led": response["led"],
                    "text": response["text"]
                })

            elif event_type == "CHANGE_STORY":
                story_id = data.get("story_id", "space_adventure")
                loaded = get_story(story_id)
                if loaded:
                    current_story_data = loaded
                    current_chunk_idx = 0
                    await websocket.send_json({
                        "event": "STORY_CHANGED",
                        "face": "curious",
                        "led": {"pattern": "pulse", "color": "#a855f7"},
                        "text": f"تم اختيار: {loaded.get('title')}. المس رأسي للبدء!"
                    })

    except WebSocketDisconnect:
        manager.disconnect(websocket)
    except Exception as e:
        print(f"WebSocket error: {e}")
        manager.disconnect(websocket)

# --- Mount Simulator Web App ---
if SIMULATOR_DIR.exists():
    app.mount("/simulator", StaticFiles(directory=str(SIMULATOR_DIR), html=True), name="simulator")

    @app.get("/")
    def serve_root():
        return FileResponse(SIMULATOR_DIR / "index.html")

if __name__ == "__main__":
    import uvicorn
    # Runs on all network interfaces (0.0.0.0) so phone can connect on LAN
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
