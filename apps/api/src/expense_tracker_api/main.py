from __future__ import annotations

import uuid

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.openapi.utils import get_openapi
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from expense_tracker_api.api.v1.router import router as v1_router
from expense_tracker_api.core.config import CORS_ORIGINS, MAX_SYNC_REQUEST_BYTES

app = FastAPI(
    title="Paisa API",
    version="1.0.0",
    description="Expense Tracker backend. All amounts are integer paise; dates are ISO calendar dates.",
    openapi_tags=[
        {"name": "health", "description": "Service health."},
        {"name": "auth", "description": "Account registration and token lifecycle."},
        {"name": "categories", "description": "User-owned transaction categories."},
        {"name": "transactions", "description": "Income and expense records."},
        {"name": "budgets", "description": "Monthly overall and category budgets."},
        {"name": "sync", "description": "Offline-first push and cursor-based pull."},
        {"name": "attachments", "description": "Private receipt image storage."},
        {"name": "ai", "description": "AI drafts; the client confirms and computes."},
    ],
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type", "X-Checksum-SHA256", "X-Transaction-ID"],
)

@app.middleware("http")
async def request_id_middleware(request: Request, call_next):
    request.state.request_id = request.headers.get("x-request-id") or str(uuid.uuid4())
    if request.url.path == "/api/v1/sync/push":
        try:
            content_length = int(request.headers.get("content-length", "0"))
        except ValueError:
            content_length = 0
        if content_length > MAX_SYNC_REQUEST_BYTES:
            return JSONResponse(
                status_code=413,
                content={
                    "error": {
                        "code": "payload_too_large",
                        "message": "Sync request exceeds 1 MiB",
                        "details": [],
                        "request_id": request.state.request_id,
                    }
                },
                headers={"X-Request-ID": request.state.request_id},
            )
    response = await call_next(request)
    response.headers["X-Request-ID"] = request.state.request_id
    return response


@app.exception_handler(StarletteHTTPException)
async def http_error_handler(request: Request, exc: StarletteHTTPException):
    detail = exc.detail
    if isinstance(detail, dict) and "code" in detail:
        body = detail
    else:
        code = {
            401: "unauthorized",
            403: "forbidden",
            404: "not_found",
            413: "payload_too_large",
        }.get(exc.status_code, "request_error")
        body = {"code": code, "message": str(detail), "details": []}
    return JSONResponse(
        status_code=exc.status_code,
        content={"error": {**body, "request_id": request.state.request_id}},
        headers=exc.headers,
    )


@app.exception_handler(RequestValidationError)
async def validation_error_handler(request: Request, exc: RequestValidationError):
    details = [
        {"path": ".".join(str(part) for part in issue["loc"]), "message": issue["msg"]}
        for issue in exc.errors()
    ]
    return JSONResponse(
        status_code=422,
        content={
            "error": {
                "code": "validation_error",
                "message": "Request validation failed",
                "details": details,
                "request_id": request.state.request_id,
            }
        },
    )


@app.exception_handler(Exception)
async def unexpected_error_handler(request: Request, exc: Exception):
    return JSONResponse(
        status_code=500,
        content={
            "error": {
                "code": "internal_error",
                "message": "An unexpected server error occurred",
                "details": [],
                "request_id": request.state.request_id,
            }
        },
    )


@app.get("/health", tags=["health"])
def health():
    return {"status": "ok"}


app.include_router(v1_router, prefix="/api/v1")


def custom_openapi():
    if app.openapi_schema:
        return app.openapi_schema
    schema = get_openapi(
        title=app.title,
        version=app.version,
        description=app.description,
        routes=app.routes,
        tags=app.openapi_tags,
    )
    for path, path_item in schema["paths"].items():
        section = path.removeprefix("/api/v1/").split("/", 1)[0]
        tag = section if section in {"auth", "categories", "transactions", "budgets", "sync", "attachments", "ai"} else "health"
        for operation in path_item.values():
            if isinstance(operation, dict) and "operationId" in operation:
                operation["tags"] = [tag]
    app.openapi_schema = schema
    return schema


app.openapi = custom_openapi
