// File: /api/cron/update-novels/route.ts
// This is the code for a Next.js API route that can be deployed to Vercel.

import { NextResponse } from 'next/server';
import { initializeApp, getApps, getApp } from 'firebase/app';
import { getFirestore, collection, getDocs, doc, writeBatch, query, orderBy, serverTimestamp } from 'firebase/firestore';
import { parse } from 'node-html-parser';

// --- Firebase Configuration ---
// IMPORTANT: In your Vercel project, you MUST set these as Environment Variables.
const firebaseConfig = {
  apiKey: process.env.AIzaSyA8TptV1xahItjFpexfqB1OtEZ71DtaogA,
  authDomain: process.env.money-d9517.firebaseapp.com,
  databaseURL: "https://money-d9517-default-rtdb.firebaseio.com",
  projectId: process.env.money-d9517,
  storageBucket: process.env.money-d9517.firebasestorage.app,
  messagingSenderId: process.env.1028474173381,
  appId: process.env.1:1028474173381:web:6e2925596d3d8a58af7dac,
};

function initializeFirebase() {
  return getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);
}


// --- Types (copied from your project's actions.ts) ---
type Chapter = {
  title: string;
  url: string;
};

type ChapterWithContent = Chapter & {
  chapterNumber: number;
  content: string;
};


// --- Helper Functions for Scraping (copied and adapted from your project) ---

async function fetchPageHtml(url: string): Promise<string> {
    const response = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36' }
    });
    if (!response.ok) {
        throw new Error(`Failed to fetch page ${url}. Status: ${response.statusText}`);
    }
    return response.text();
}

const scrapeChaptersFromHtml = (html: string, baseUrl: string): Chapter[] => {
    const dom = parse(html);
    const chapterContainer = dom.querySelector('#list-chapter');
    if (!chapterContainer) return [];

    const links = chapterContainer.querySelectorAll('ul.list-chapter li a');
    const chapters: Chapter[] = [];
    const base = new URL(baseUrl);

    for (const link of links) {
        const href = link.getAttribute('href');
        const title = link.getAttribute('title');

        if (href && title) {
            const url = new URL(href, base.origin).href;
            chapters.push({ title, url });
        }
    }
    return chapters;
};

const findAllChaptersAction = async (novelUrl: string): Promise<{ success: true, chapters: Chapter[] } | { success: false, error: string }> => {
    try {
        const firstPageHtml = await fetchPageHtml(novelUrl);
        const dom = parse(firstPageHtml);

        let totalPages = 1;
        const lastPageLink = dom.querySelector('.pagination .last a');
        if (lastPageLink) {
            const pageUrl = lastPageLink.getAttribute('href');
            if (pageUrl) {
                const urlParams = new URLSearchParams(pageUrl.split('?')[1]);
                totalPages = parseInt(urlParams.get('page') || '1', 10);
            }
        } else {
             const pageLinks = dom.querySelectorAll('.pagination a[data-page]');
             if (pageLinks.length > 0) {
                 const pageNumbers = pageLinks.map(link => parseInt(link.getAttribute('data-page') || '0', 10)).filter(n => !isNaN(n));
                 if (pageNumbers.length > 0) totalPages = Math.max(...pageNumbers) + 1;
             }
        }

        const pageUrls: string[] = [];
        const base = new URL(novelUrl);
        for (let i = 1; i <= totalPages; i++) {
            const pageUrl = new URL(base.href);
            pageUrl.searchParams.set('page', i.toString());
            pageUrls.push(pageUrl.href);
        }

        const allPagesHtml = await Promise.all(pageUrls.map(url => fetchPageHtml(url).catch(() => '')));
        const allChapters: Chapter[] = [];
        const chapterUrlSet = new Set<string>();

        for (const html of allPagesHtml) {
            if (html) {
                const chaptersFromPage = scrapeChaptersFromHtml(html, novelUrl);
                for (const chapter of chaptersFromPage) {
                    if (!chapterUrlSet.has(chapter.url)) {
                        allChapters.push(chapter);
                        chapterUrlSet.add(chapter.url);
                    }
                }
            }
        }

        return { success: true, chapters: allChapters };
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        return { success: false, error: message };
    }
}

const extractSingleChapterAction = async (chapterUrl: string): Promise<{ success: true, content: string } | { success: false, error: string }> => {
    try {
        const html = await fetchPageHtml(chapterUrl);
        const dom = parse(html);
        const chapterContentElement = dom.querySelector('#chapter-content');
        if (!chapterContentElement) throw new Error(`Could not find #chapter-content`);

        chapterContentElement.querySelectorAll('div[align="center"], div.ads, script').forEach(el => el.remove());
        const content = chapterContentElement.innerHTML.trim();
        if (!content) throw new Error(`Content extraction returned empty content.`);

        return { success: true, content: content };
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        return { success: false, error: message };
    }
}

const updateNovelChaptersAction = async (novelId: string, newChapters: ChapterWithContent[]): Promise<{ success: true, novelId: string } | { success: false, error: string }> => {
     try {
        const db = getFirestore(initializeFirebase());
        const novelRef = doc(db, 'novels', novelId);
        const chaptersCollectionRef = collection(db, 'novels', novelId, 'chapters');

        const q = query(chaptersCollectionRef, orderBy('chapterNumber', 'desc'));
        const existingChaptersSnapshot = await getDocs(q);
        const lastChapterNumber = existingChaptersSnapshot.empty ? 0 : existingChaptersSnapshot.docs[0].data().chapterNumber;

        const batch = writeBatch(db);
        newChapters.forEach((chapter, index) => {
            const chapterDocRef = doc(chaptersCollectionRef);
            batch.set(chapterDocRef, { ...chapter, chapterNumber: lastChapterNumber + index + 1 });
        });
        batch.update(novelRef, { updatedAt: serverTimestamp() });
        await batch.commit();

        return { success: true, novelId: novelId };
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        return { success: false, error: message };
    }
}

const getChapterNumber = (chapter: { title: string, url: string }): number => {
    const titleMatch = chapter.title.match(/(\d+)/);
    if (titleMatch) return parseInt(titleMatch[0], 10);
    const urlMatches = chapter.url.match(/(\d+)/g);
    if (urlMatches) return parseInt(urlMatches[urlMatches.length - 1], 10);
    return 99999;
};

function cleanChapterTitle(title: string): string {
    return title.replace(/^((c|chapter|ch)\.?\s*\d+\s*[:-]?\s*)|(^\d+\s*[:-]?\s*)/i, '').trim();
}


// --- Main Cron Job Logic ---
export async function GET() {
    console.log('Cron job started: Checking for new chapters...');
    try {
        const db = getFirestore(initializeFirebase());
        const novelsSnapshot = await getDocs(collection(db, 'novels'));

        if (novelsSnapshot.empty) {
            return NextResponse.json({ success: true, message: 'No novels to update.' });
        }

        let totalNewChapters = 0;

        for (const novelDoc of novelsSnapshot.docs) {
            const novelId = novelDoc.id;
            const novelData = novelDoc.data();
            const novelUrl = novelData.novelUrl;

            if (!novelUrl) {
                console.warn(`Novel ${novelId} is missing novelUrl. Skipping.`);
                continue;
            }

            console.log(`Checking for updates for: ${novelData.title}`);

            const allChaptersResult = await findAllChaptersAction(novelUrl);
            if (!allChaptersResult.success) {
                console.error(`Failed to fetch chapters for ${novelData.title}: ${allChaptersResult.error}`);
                continue;
            }

            const existingChaptersCol = await getDocs(collection(db, 'novels', novelId, 'chapters'));
            const existingChapterUrls = new Set(existingChaptersCol.docs.map(doc => doc.data().url));

            const newChapters = allChaptersResult.chapters
                .filter(chapter => !existingChapterUrls.has(chapter.url))
                .sort((a,b) => getChapterNumber(a) - getChapterNumber(b));

            if (newChapters.length === 0) {
                console.log(`No new chapters for: ${novelData.title}`);
                continue;
            }

            console.log(`Found ${newChapters.length} new chapters for ${novelData.title}. Starting extraction...`);

            const newChaptersWithContent: ChapterWithContent[] = [];
            for (const chapter of newChapters) {
                 const extractResult = await extractSingleChapterAction(chapter.url);
                 if (extractResult.success) {
                     newChaptersWithContent.push({
                         ...chapter,
                         chapterNumber: 0,
                         title: cleanChapterTitle(chapter.title),
                         content: extractResult.content,
                     });
                 } else {
                    console.error(`Failed to extract chapter "${chapter.title}". Error: ${extractResult.error}`);
                 }
                 await new Promise(res => setTimeout(res, 500));
            }

            if (newChaptersWithContent.length > 0) {
                const saveResult = await updateNovelChaptersAction(novelId, newChaptersWithContent);
                if (saveResult.success) {
                    totalNewChapters += newChaptersWithContent.length;
                    console.log(`Successfully added ${newChaptersWithContent.length} new chapters for ${novelData.title}.`);
                } else {
                    console.error(`Failed to save new chapters for ${novelData.title}: ${saveResult.error}`);
                }
            }
        }

        return NextResponse.json({ success: true, message: `Update complete. Added ${totalNewChapters} new chapters.` });

    } catch (error: unknown) {
        console.error('Cron job failed with an unhandled error:', error);
        const message = error instanceof Error ? error.message : String(error);
        return NextResponse.json({ success: false, error: message }, { status: 500 });
    }
}
