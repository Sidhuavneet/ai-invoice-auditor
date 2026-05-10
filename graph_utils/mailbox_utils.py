from apscheduler.schedulers.background import BackgroundScheduler
import time,shutil,os
import json

added_files_path="outputs/added.json"

def load_or_create_json(path, default_data=None):
    print("loader_called")
    if default_data is None:
        default_data = []

    if os.path.exists(path):
        with open(path, "r") as f:
            try:
                return json.load(f)
            except json.JSONDecodeError:
                # File exists but is empty or corrupted
                return default_data
    else:
        with open(path, "w") as f:
            json.dump(default_data, f, indent=4)
        return default_data
        



def sender(source,target,delay):
    print("Sender Started")
    scheduler = BackgroundScheduler()
    scheduler.add_job(send, 'interval', seconds=delay,args=[source,target])
    scheduler.start()



def send(source,target):
    print("-------------sending--------------")
    for f in os.listdir(source):
        if f.endswith(('.pdf',".docx",".png")) and f not in os.listdir(target):
            shutil.copy(os.path.join(source,f),target)
            f_name=f[:f.rfind(".")]
            meta=f_name+".meta.json"
            if meta in os.listdir(source):
                shutil.copy(os.path.join(source,meta),target)
                print(f"simualted arrival of {meta}")
            print(f"simualted arrival of {f}")
            break


def poll(target):
    print("----------------polling-----------------")
    added=load_or_create_json(added_files_path)
    out={"file":"","meta":""}
    for fname in os.listdir(target):
        if fname.endswith(('.pdf',".docx",".png",".jpg",".jpeg")):
            if fname not in added:
                print("open file",fname)
                f_name=fname[:fname.rfind(".")]
                out["file"]=fname
                meta=f_name+".meta.json"
                if meta in os.listdir(target):
                    print("open meta",meta)
                    out["meta"]=meta
                added.append(fname)
                with open(added_files_path, "w") as fh:
                    json.dump(added, fh, indent=4)
                print(f"simulated ingestion of {fname}")
                return out


def unmark(filename):
    """Remove a file from the processed list so it can be retried."""
    added=load_or_create_json(added_files_path)
    if filename in added:
        added.remove(filename)
        with open(added_files_path, "w") as fh:
            json.dump(added, fh, indent=4)

