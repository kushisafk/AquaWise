"""AquaWise root application entry point."""

import os
import sys
from pathlib import Path
import uvicorn

# Ensure the backend directory is on the Python module search path
BACKEND_DIR = Path(__file__).resolve().parent / "backend"
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))


def main():
    port = int(os.environ.get("PORT", 5000))
    host = os.environ.get("HOST", "0.0.0.0")
    print(f"Starting AquaWise API Server on http://{host}:{port} ...")
    uvicorn.run("main:app", host=host, port=port, reload=True, app_dir=str(BACKEND_DIR))


if __name__ == "__main__":
    main()
