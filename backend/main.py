#!/usr/bin/env python3

import uvicorn


if __name__ == "__main__":
    uvicorn.run("app:app", app_dir="backend", host="127.0.0.1", port=8001, reload=False)
