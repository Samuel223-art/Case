import firebase_admin
from firebase_admin import credentials, firestore
import re
import time
import os
import requests
from bs4 import BeautifulSoup

# --- 1. FIRESTORE AUTHENTICATION ---
# This script is intended to be run locally.
# It requires the 'serviceAccountKey.json' file to be in the same directory.
cred_filename = "serviceAccountKey.json"

try:
    if not firebase_admin._apps:
        if os.path.exists(cred_filename):
            cred = credentials.Certificate(cred_filename)
            firebase_admin.initialize_app(cred)
            print(f"✅ Firestore initialized using {cred_filename}")
        else:
            print(f"⚠️ Warning: '{cred_filename}' not found. Attempting default application login...")
            print("   This may work if you've run 'gcloud auth application-default login' in your terminal.")
            firebase_admin.initialize_app()

    db = firestore.client()

except Exception as e:
    print(f"❌ FATAL ERROR: Could not connect to Firestore.")
    print(f"   Ensure '{cred_filename}' is present or you are authenticated in your environment.")
    print(f"   Error details: {e}")
    exit()


# --- WEB SCRAPING CONSTANTS ---
BASE = "https://novelfull.net"
HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
}

# --- HELPER FUNCTIONS (identical to main.py) ---

def clean_chapter_title(title):
    title = title.strip()
    match_c = re.match(r'^(C\d+[:\-]?\s*)', title, re.IGNORECASE)
    if match_c:
        return title[len(match_c.group(0)):].strip()
    match_chapter = re.match(r'^(Chapter\s+[\w\d\.]+\s*[:\-]?\s*)', title, re.IGNORECASE)
    if match_chapter:
        return title[len(match_chapter.group(0)):].strip()
    return title

def generate_smart_tags(title, synopsis, existing_genres):
    tags = [g.strip() for g in existing_genres]
    keywords = {
        "system": "System", "reincarnat": "Reincarnation", "transmigrat": "Transmigration",
        "cultivat": "Cultivation", "villain": "Villain", "apocalyp": "Apocalypse",
        "game": "Game Elements", "magic": "Magic", "sword": "Sword & Magic",
        "god": "Gods", "demon": "Demons", "revenge": "Revenge", "academy": "Academy",
        "school": "School Life", "funny": "Comedy", "comedy": "Comedy",
        "horror": "Horror", "mystery": "Mystery", "slice of life": "Slice of Life",
        "bl": "BL", "boys love": "BL"
    }
    search_text = (title + " " + synopsis).lower()
    for key, tag_label in keywords.items():
        if key in search_text and tag_label not in tags:
            tags.append(tag_label)
    unique_tags = list(dict.fromkeys(tags))
    return unique_tags[:6]

def get_chapter_content(chapter_url):
    try:
        time.sleep(0.5)
        r = requests.get(chapter_url, headers=HEADERS)
        r.raise_for_status()
        soup = BeautifulSoup(r.text, "html.parser")
        content_div = soup.find("div", id="chapter-content")

        if content_div:
            for bad_tag in content_div(["script", "style", "div", "center", "iframe", "h3"]):
                bad_tag.decompose()
            return content_div.decode_contents().strip()
        return "<p>Content not available.</p>"
    except Exception as e:
        print(f"   ⚠️ Error scraping content from {chapter_url}: {e}")
        return f"<p>Error loading content: {e}</p>"

# --- MAIN SCRAPER LOGIC (identical to main.py) ---

def scrape_and_save(initial_url):
    """
    Scrapes a novel's metadata and chapters and saves them to Firestore.
    Returns True on success, False on failure.
    """

    if "?" in initial_url:
        base_novel_url = initial_url.split("?")[0]
    else:
        base_novel_url = initial_url

    doc_id = re.sub(r'[^\w\-]', '-', base_novel_url).strip('-')
    novel_ref = db.collection('novels').document(doc_id)

    print(f"🚀 STARTING JOB: {base_novel_url}")

    novel_doc = novel_ref.get()
    if novel_doc.exists:
        print(f"🟡 SKIP: Novel '{novel_doc.get('title')}' already exists in Firestore.")
        return True

    print(f"✨ New Novel Detected. Starting scrape...")

    try:
        response = requests.get(base_novel_url, headers=HEADERS)
        response.raise_for_status()
    except Exception as e:
        print(f"❌ Error fetching novel page: {e}")
        return False

    soup = BeautifulSoup(response.text, "html.parser")

    title_tag = soup.select_one(".desc .title") or soup.select_one("h3.title")
    title = title_tag.get_text(strip=True) if title_tag else "Unknown Title"

    img_tag = soup.select_one(".book img")
    img_src = img_tag.get("src", "") if img_tag else ""
    if img_src.startswith("http"):
        cover_url = img_src
    else:
        cover_url = BASE + img_src if img_src.startswith("/") else BASE + "/" + img_src

    genre_container = soup.select_one(".info div:nth-of-type(2)")
    all_genres = []
    if genre_container:
        raw_genre_text = genre_container.get_text().replace("Genre:", "").strip()
        all_genres = [g.strip() for g in raw_genre_text.split(',')]

    primary_genre = all_genres[0] if all_genres else "Unknown"
    remaining_genres = all_genres[1:]

    desc_div = soup.select_one(".desc-text")
    synopsis = desc_div.decode_contents().strip() if desc_div else "<p>No synopsis.</p>"

    final_tags = generate_smart_tags(title, synopsis, remaining_genres)

    metadata_to_post = {
        "title": title, "author": "Unknown", "genre": primary_genre,
        "status": "Ongoing", "synopsis": synopsis, "coverUrl": cover_url,
        "novelUrl": base_novel_url, "tags": final_tags,
        "createdAt": firestore.SERVER_TIMESTAMP
    }

    try:
        author_tag = soup.select_one(".info div:nth-of-type(1) a")
        if author_tag: metadata_to_post['author'] = author_tag.get_text(strip=True)
        status_tag = soup.select_one(".info div:nth-of-type(4) a")
        if status_tag: metadata_to_post['status'] = status_tag.get_text(strip=True)
    except: pass

    novel_ref.set(metadata_to_post, merge=True)
    print(f"✅ Metadata saved for: {title}")

    # Chapter Scraping
    all_chapters = set()
    page = 1
    chapter_global_index = 1

    while True:
        page_url = base_novel_url if page == 1 else f"{base_novel_url}?page={page}"
        print(f"   📄 Page {page}...", end="\r")

        try:
            r = requests.get(page_url, headers=HEADERS)
            r.raise_for_status()
        except Exception as e:
            print(f"\n   ⚠️ Page {page} error, stopping chapter loop: {e}")
            break

        sp = BeautifulSoup(r.text, "html.parser")
        chapter_tags = sp.select(".list-chapter li a")

        if not chapter_tags: break

        batch = db.batch()
        batch_count = 0

        for tag in chapter_tags:
            chapter_link = tag.get("href", "")
            if chapter_link.startswith("/"): chapter_link = BASE + chapter_link

            chapter_doc_id = re.sub(r'[^\w\-]', '-', chapter_link).strip('-')

            if chapter_doc_id not in all_chapters:
                all_chapters.add(chapter_doc_id)
                cleaned_title = clean_chapter_title(tag.get_text(strip=True))
                content_html = get_chapter_content(chapter_link)

                chapter_ref = novel_ref.collection('chapters').document(chapter_doc_id)
                batch.set(chapter_ref, {"chapterNumber": chapter_global_index, "title": cleaned_title, "url": chapter_link, "content": content_html})
                batch_count += 1
                chapter_global_index += 1

        if batch_count > 0: batch.commit()
        else: break

        page += 1

    print(f"\n✨ COMPLETED: {title} ({len(all_chapters)} chapters)")
    return True

# --- BACKLOG PROCESSING LOOP ---

if __name__ == "__main__":
    print("--- ⚙️ BACKLOG PROCESSOR STARTED ---")

    queue_ref = db.collection('scrapingQueue')
    docs = queue_ref.stream()

    # Convert generator to a list to get a static count and avoid issues with deleting during iteration.
    doc_list = list(docs)
    total_docs = len(doc_list)

    if total_docs == 0:
        print("✅ Queue is empty. No backlog to process.")
    else:
        print(f"Found {total_docs} item(s) in the queue. Starting process...")

        for i, doc in enumerate(doc_list):
            doc_id = doc.id
            data = doc.to_dict()
            url = data.get('url')

            print(f"\n--- Processing item {i+1} of {total_docs} (ID: {doc_id}) ---")

            if url:
                scrape_and_save(url)
            else:
                print("⚠️ URL not found in document. Skipping.")

            # Always delete the item after processing to clear the queue.
            try:
                queue_ref.document(doc_id).delete()
                print(f"🗑️ Queue item {doc_id} processed and deleted.")
            except Exception as e:
                print(f"❌ CRITICAL: Failed to delete item {doc_id}. Manual removal may be needed. Error: {e}")

        print("\n--- ✅ BACKLOG PROCESSING COMPLETE ---")
