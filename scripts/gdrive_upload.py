"""Upload a single file into a named child folder on Google Drive via OAuth.

Invoked from GitHub Actions steps so CI backups avoid the Service Account
storage quota. The child folder is resolved by name under the shared parent;
if it doesn't exist yet, it is created once, then reused on subsequent runs.

Required env vars:
  CLIENT_ID, CLIENT_SECRET, REFRESH_TOKEN  OAuth app credentials.
  FOLDER_ID     Drive ID of the shared parent folder.
  CHILD_FOLDER  Name of the child folder (resolved or created under FOLDER_ID).
  FILE_PATH     Absolute path of the local file to upload.
  FILE_NAME     Name to give the uploaded file on Drive.
"""
import json
import os
import sys

import requests

TOKEN_URL = "https://oauth2.googleapis.com/token"
DRIVE_FILES_URL = "https://www.googleapis.com/drive/v3/files"
DRIVE_UPLOAD_URL = "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart"
FOLDER_MIME = "application/vnd.google-apps.folder"


def get_access_token() -> str:
    res = requests.post(TOKEN_URL, data={
        "client_id": os.environ["CLIENT_ID"],
        "client_secret": os.environ["CLIENT_SECRET"],
        "refresh_token": os.environ["REFRESH_TOKEN"],
        "grant_type": "refresh_token",
    })
    token = res.json().get("access_token")
    if not token:
        print("Failed to get access token:", res.text)
        sys.exit(1)
    return token


def resolve_or_create_child(headers: dict, parent_id: str, child_name: str) -> str:
    query = (
        f"name = '{child_name}' and "
        f"mimeType = '{FOLDER_MIME}' and "
        f"'{parent_id}' in parents and trashed = false"
    )
    search = requests.get(
        DRIVE_FILES_URL,
        headers=headers,
        params={"q": query, "fields": "files(id, name)"},
    )
    matches = search.json().get("files", [])
    if matches:
        child_id = matches[0]["id"]
        print(f"Using existing child folder {child_name}: {child_id}")
        return child_id

    create = requests.post(
        DRIVE_FILES_URL,
        headers={**headers, "Content-Type": "application/json"},
        data=json.dumps({
            "name": child_name,
            "mimeType": FOLDER_MIME,
            "parents": [parent_id],
        }),
    )
    child_id = create.json().get("id")
    if not child_id:
        print("Failed to create child folder:", create.text)
        sys.exit(1)
    print(f"Created child folder {child_name}: {child_id}")
    return child_id


def main() -> int:
    headers = {"Authorization": f"Bearer {get_access_token()}"}
    child_id = resolve_or_create_child(
        headers,
        os.environ["FOLDER_ID"],
        os.environ["CHILD_FOLDER"],
    )

    metadata = {"name": os.environ["FILE_NAME"], "parents": [child_id]}
    with open(os.environ["FILE_PATH"], "rb") as fh:
        files = {
            "metadata": ("metadata", json.dumps(metadata), "application/json; charset=UTF-8"),
            "file": fh,
        }
        upload = requests.post(DRIVE_UPLOAD_URL, headers=headers, files=files)

    body = upload.json()
    print("Upload Response:", body)
    if "error" in body:
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
