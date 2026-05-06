import yaml

def fetch_rules(file_path="config/rules.yaml"):
    with open(file_path, 'r') as file:
        data = yaml.safe_load(file)
    return data