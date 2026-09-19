import os
from dotenv import load_dotenv
load_dotenv('.env')
from pymongo import MongoClient
try:
    c = MongoClient(os.environ['MONGO_URL'], serverSelectionTimeoutMS=5000)
    db = c[os.environ['DB_NAME']]
    print('DB:', os.environ['DB_NAME'])
    print('users:', db.users.count_documents({}))
    print('employees:', db.employees.count_documents({}))
    print('repair_items:', db.repair_items.count_documents({}))
    print('usernames:', [u.get('username') for u in db.users.find({}, {'username':1,'_id':0})])
except Exception as e:
    print('DB ERROR:', type(e).__name__, str(e)[:80])
