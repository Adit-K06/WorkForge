from dotenv import load_dotenv

load_dotenv(".env.local")

import uvicorn


if __name__ == "__main__":
    uvicorn.run("api.index:app", host="127.0.0.1", port=8000, reload=True)
