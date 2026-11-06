"""
AI Proctoring Service — FastAPI.

Endpoint:
  GET  /health         liveness  (process còn sống)
  GET  /ready          readiness (model nào loaded / lỗi gì) — 503 nếu chưa sẵn sàng
  GET  /metrics        latency p50/p95/p99, dropped(busy), inflight, theo module
  POST /register-face  trích embedding tham chiếu (pre-check)
  POST /analyze        phân tích 1 frame — schema `proctoring.analyze.v2`

Lỗi luôn có dạng {"error": {"code": "...", "message": "..."}, "request_id": "..."}.
Khởi động: uvicorn app:app --host 0.0.0.0 --port 8001
"""

import asyncio
import logging
import os
import time
import uuid
from collections import deque
from contextlib import asynccontextmanager

from fastapi import FastAPI, File, Form, Header, Request, UploadFile
from fastapi.responses import JSONResponse
from starlette.concurrency import run_in_threadpool

import proctoring_pipeline as pp

logging.basicConfig(level=os.environ.get("AI_LOG_LEVEL", "INFO"),
                    format="%(asctime)s %(levelname)s %(name)s: %(message)s")
log = logging.getLogger("ai-service")

MAX_CONCURRENCY = pp._env_int("AI_MAX_CONCURRENCY", 1)   # CPU: 1 là hợp lý, torch đã đa luồng
MAX_QUEUE = pp._env_int("AI_MAX_QUEUE", 4)               # số request được phép chờ; quá thì AI_BUSY


class Metrics:
    """Số liệu in-memory, đủ cho benchmark và health; không thay Prometheus."""

    def __init__(self):
        self.started = time.time()
        self.completed = 0
        self.failed = 0
        self.rejected_busy = 0
        self.inflight = 0
        self.waiting = 0
        self.latency = deque(maxlen=500)
        self.stage = {}

    def record(self, result: dict):
        self.completed += 1
        self.latency.append(result["inference_ms"])
        for k, v in result.get("timings_ms", {}).items():
            self.stage.setdefault(k, deque(maxlen=200)).append(v)

    @staticmethod
    def _pct(values, p):
        if not values:
            return None
        s = sorted(values)
        return s[min(len(s) - 1, int(round((p / 100) * (len(s) - 1))))]

    def snapshot(self):
        lat = list(self.latency)
        up = max(time.time() - self.started, 1e-6)
        return {
            "uptime_sec": round(up, 1),
            "completed": self.completed, "failed": self.failed,
            "rejected_busy": self.rejected_busy,
            "inflight": self.inflight, "waiting": self.waiting,
            "max_concurrency": MAX_CONCURRENCY, "max_queue": MAX_QUEUE,
            "throughput_per_sec": round(self.completed / up, 2),
            "latency_ms": {"p50": self._pct(lat, 50), "p95": self._pct(lat, 95), "p99": self._pct(lat, 99)},
            "stage_p50_ms": {k: self._pct(list(v), 50) for k, v in self.stage.items()},
        }


metrics = Metrics()
semaphore: asyncio.Semaphore


@asynccontextmanager
async def lifespan(_app: FastAPI):
    global semaphore
    semaphore = asyncio.Semaphore(MAX_CONCURRENCY)
    # Raise => uvicorn không khởi động. Cố ý: không phục vụ request khi thiếu model.
    await run_in_threadpool(pp.load_all_models)
    log.info("AI service sẵn sàng.")
    yield


app = FastAPI(title="AI Proctoring Service", lifespan=lifespan)


def _err(code: str, message: str, status: int, request_id: str | None):
    return JSONResponse(
        {"error": {"code": code, "message": message}, "request_id": request_id}, status_code=status,
        headers={"X-Request-Id": request_id or ""},
    )


@app.exception_handler(pp.PipelineError)
async def _pipeline_error_handler(_req: Request, exc: pp.PipelineError):
    return _err(exc.code, exc.message, exc.http_status, getattr(_req.state, "request_id", None))


@app.get("/health")
def health():
    return {"status": "ok", "device": str(pp.DEVICE)}


@app.get("/ready")
def ready():
    m = pp.MODELS
    body = {
        "status": "ready" if m.ready else "not_ready",
        "schema_version": pp.SCHEMA_VERSION,
        "device": str(pp.DEVICE),
        "started_at": m.started_at,
        "models": {k: v.as_dict() for k, v in m.status.items()},
    }
    return JSONResponse(body, status_code=200 if m.ready else 503)


@app.get("/metrics")
def get_metrics():
    return metrics.snapshot()


async def _run_bounded(fn, request_id: str):
    """Giới hạn đồng thời; hàng đợi đầy => từ chối ngay (AI_BUSY) thay vì xếp hàng vô hạn."""
    if metrics.waiting >= MAX_QUEUE:
        metrics.rejected_busy += 1
        raise pp.PipelineError("AI_BUSY", "AI service đang quá tải, thử lại sau", 429)
    metrics.waiting += 1
    try:
        await semaphore.acquire()
    finally:
        metrics.waiting -= 1
    metrics.inflight += 1
    try:
        return await run_in_threadpool(fn)
    finally:
        metrics.inflight -= 1
        semaphore.release()


@app.post("/register-face")
async def register_face(
    request: Request, image: UploadFile = File(...),
    x_request_id: str | None = Header(default=None),
):
    rid = x_request_id or uuid.uuid4().hex
    request.state.request_id = rid
    raw = await image.read()
    try:
        result = await _run_bounded(lambda: pp.register_face(pp.MODELS, raw, rid), rid)
    except pp.PipelineError:
        metrics.failed += 1
        raise
    return JSONResponse(result, headers={"X-Request-Id": rid})


@app.post("/analyze")
async def analyze(
    request: Request,
    image: UploadFile = File(...),
    run_face: bool = Form(True),
    run_head_pose: bool = Form(False),
    run_gaze: bool = Form(False),
    run_objects: bool = Form(False),
    reference_embedding: str | None = Form(None),
    x_request_id: str | None = Header(default=None),
):
    rid = x_request_id or uuid.uuid4().hex
    request.state.request_id = rid
    if not pp.MODELS.ready:
        return _err("MODEL_UNAVAILABLE", "AI service chưa sẵn sàng", 503, rid)

    raw = await image.read()
    reference = pp.parse_reference_embedding(reference_embedding)
    try:
        result = await _run_bounded(
            lambda: pp.analyze(
                pp.MODELS, raw, run_face=run_face, run_head_pose=run_head_pose, run_gaze=run_gaze,
                run_objects=run_objects, reference=reference, request_id=rid),
            rid,
        )
    except pp.PipelineError:
        metrics.failed += 1
        raise
    metrics.record(result)
    return JSONResponse(result, headers={"X-Request-Id": rid})


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "app:app",
        host=os.environ.get("AI_HOST", "0.0.0.0"),
        port=int(os.environ.get("AI_PORT", "8001")),
    )
