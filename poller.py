from graph_utils import mailbox_utils
import time
from graph import app
import os
from apscheduler.schedulers.background import BackgroundScheduler
import time,shutil,os


def monitor():
    target="inbox"
    paths=mailbox_utils.poll(target)
    print(paths)
    if paths:
        file_path=f"{target}/{paths['file']}"
        metadata_path=f"{target}/{paths['meta']}" if paths["meta"] else ""
        file_name=paths["file"][:paths["file"].rfind(".")]
        app.invoke({"file_path":file_path,"metadata_path":metadata_path,"file_name":file_name},config={"configurable":{"thread_id":file_name}})


def poller():
    print("poller Started")
    scheduler = BackgroundScheduler()
    scheduler.add_job(monitor, 'interval', seconds=20)
    scheduler.start()
