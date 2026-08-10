import os
os.environ.setdefault('MONGO_URL', 'mongodb://localhost:27017')
os.environ.setdefault('DB_NAME', 'rmj_import_test')
import motor.motor_asyncio
from mongomock_motor import AsyncMongoMockClient
motor.motor_asyncio.AsyncIOMotorClient = lambda *a, **kw: AsyncMongoMockClient()
import uvicorn
import server
uvicorn.run(server.app, host='127.0.0.1', port=8123, log_level='warning')
