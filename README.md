# Novel Scraper Cloud Function

This project contains two key components:
1.  **A Google Cloud Function (`main.py`)**: An event-driven function that automatically scrapes a novel from `novelfull.net` when its URL is added to a Firestore `scrapingQueue`.
2.  **A Backlog Processor (`process_backlog.py`)**: A one-time script to clear any existing URLs in the `scrapingQueue`.

---

## 📋 Prerequisites

Before you begin, ensure you have the following:

1.  **A Google Cloud Project**: Your Firestore database should be part of a Google Cloud project.
2.  **Python 3.8+**: Installed on your local machine.
3.  **Google Cloud SDK**: Installed and configured on your local machine. You can install it by following the [official instructions](https://cloud.google.com/sdk/docs/install). After installation, run `gcloud init`.
4.  **Enabled APIs**: In your Google Cloud project, make sure the following APIs are enabled:
    *   Cloud Functions API
    *   Cloud Build API
    *   Cloud Logging API
    You can enable them by searching for them in the Google Cloud Console's search bar and clicking "Enable".

---

## 🚀 Step 1: Process Your Existing Backlog

This step is for clearing out any links that are **already** in your `scrapingQueue`. If your queue is empty, you can skip to Step 2.

**1.1. Get Your Service Account Key**

This script runs locally, so it needs a key file to authenticate with your Firestore database.

1.  Go to the Google Cloud Console.
2.  Navigate to **IAM & Admin > Service Accounts**.
3.  Find the service account you use for your application (often the "App Engine default service account" works well) or create a new one with at least "Cloud Datastore User" or "Editor" permissions.
4.  Click the three-dot menu (⋮) under **Actions** for that service account and select **Manage keys**.
5.  Click **ADD KEY > Create new key**.
6.  Choose **JSON** as the key type and click **CREATE**. A `.json` file will be downloaded.
7.  **IMPORTANT**: Rename this file to `serviceAccountKey.json` and place it in the same directory as these scripts. **Do not commit this file to a public repository!**

**1.2. Install Dependencies**

Open a terminal in the project directory and run:

```bash
pip install -r requirements.txt
```

**1.3. Run the Backlog Script**

Execute the script from your terminal:

```bash
python process_backlog.py
```

The script will now iterate through all the links in your `scrapingQueue`, scrape them, and delete them one by one. You can monitor its progress in the terminal.

---

## ☁️ Step 2: Deploy the Cloud Function

This function will handle all *new* links added to the queue from now on.

**2.1. Find Your Project ID and Region**

*   **Project ID**: You can find this on the main dashboard of the Google Cloud Console.
*   **Region**: Choose a region where you want to deploy your function (e.g., `us-central1`, `europe-west1`).

**2.2. Deploy from Your Terminal**

Open a terminal in the project directory and run the following command. **Make sure to replace the placeholders** `<YOUR_PROJECT_ID>` and `<YOUR_REGION>` with your actual values.

```bash
gcloud functions deploy novel_scraper_function \
--gen2 \
--runtime=python311 \
--region=<YOUR_REGION> \
--source=. \
--entry-point=process_queue \
--trigger-event-filters="type=google.cloud.firestore.document.v1.created" \
--trigger-event-filters-path-pattern="projects/<YOUR_PROJECT_ID>/databases/(default)/documents/scrapingQueue/{docId}"
```

**Command Breakdown:**
*   `novel_scraper_function`: The name we are giving our new cloud function.
*   `--gen2`: Specifies the 2nd generation of Cloud Functions, which is recommended.
*   `--runtime=python311`: Sets the Python version for the environment.
*   `--region`: The geographical location where your function will run.
*   `--source=.`: Tells gcloud to upload the code from the current directory.
*   `--entry-point=process_queue`: Specifies that the function named `process_queue` in `main.py` is the one to execute.
*   `--trigger-event-filters`: This is the magic part. It tells the function to run only when...
    *   `type=...created`: ...a new document is **created**...
    *   `path-pattern=...`: ...in the `scrapingQueue` collection of your Firestore database.

The deployment process may take a few minutes.

---

## ✅ Step 3: Verify Everything Works

1.  **Go to your Firestore Database** in the Google Cloud Console.
2.  Navigate to your `scrapingQueue` collection.
3.  **Add a new document**. It can have an auto-generated ID.
4.  Inside this document, add a **field** with the name `url` and the type `string`.
5.  For the value, paste a link to a novel on `novelfull.net` that is **not** yet in your `novels` collection.
6.  **Check the logs**: Go to **Cloud Functions** in the console, click on `novel_scraper_function`, and go to the **LOGS** tab. Within a few moments, you should see logs appearing that show the function running and scraping the novel.

If you see the logs and the new novel appears in your `novels` collection, the deployment was a success! The system is now fully automated.
