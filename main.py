"""AquaWise root application entry point."""

import os
import sys
from pathlib import Path
import uvicorn

# Ensure the api-server directory is on the Python module search path
API_SERVER_DIR = Path(__file__).resolve().parent / "artifacts" / "api-server"
if str(API_SERVER_DIR) not in sys.path:
    sys.path.insert(0, str(API_SERVER_DIR))


def main():
    port = int(os.environ.get("PORT", 5000))
    host = os.environ.get("HOST", "0.0.0.0")
    print(f"Starting AquaWise API Server on http://{host}:{port} ...")
    uvicorn.run("main:app", host=host, port=port, reload=True, app_dir=str(API_SERVER_DIR))


if __name__ == "__main__":
    main()
