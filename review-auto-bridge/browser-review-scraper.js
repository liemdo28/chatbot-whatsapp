const fs = require('fs');
const path = require('path');
const { STORE_SOURCES } = require('./review-sources');

function resolvePlaywrightModule() {
    const candidates = [
        path.join(__dirname, 'node_modules', 'playwright-core'),
        path.join(__dirname, '..', 'doordash-campaign-agent', 'node_modules', 'playwright-core'),
        path.join(__dirname, '..', 'doordash-campaign-agent', 'node_modules', 'playwright'),
    ];

    for (const candidate of candidates) {
        if (fs.existsSync(candidate)) {
            return require(candidate);
        }
    }

    throw new Error('playwright-core not found. Run npm install in review-auto-bridge.');
}

function resolveBrowserExecutable() {
    const candidates = [
        process.env.REVIEW_BROWSER_EXECUTABLE,
        'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
        'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
        'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
        'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    ].filter(Boolean);

    for (const candidate of candidates) {
        if (fs.existsSync(candidate)) {
            return candidate;
        }
    }

    throw new Error('No local Chrome/Edge executable found for browser fallback scraping.');
}

function normalizeText(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
}

function parseNumericRating(value) {
    const match = /(\d(?:\.\d)?)/.exec(String(value || ''));
    if (!match) return null;
    const rating = Number.parseFloat(match[1]);
    return Number.isFinite(rating) ? rating : null;
}

function parseReviewCount(value) {
    const match = /([\d,]+)\s+Google reviews/i.exec(value) || /\(([\d,]+)\)\s+user reviews/i.exec(value);
    if (!match) return null;
    return Number.parseInt(match[1].replace(/,/g, ''), 10);
}

function parseTextFragment(url) {
    try {
        const fragment = new URL(url).hash || '';
        const marker = '#:~:text=';
        if (!fragment.startsWith(marker)) return '';
        const raw = fragment.slice(marker.length).split('&text=')[0];
        return decodeURIComponent(raw).replace(/,.*$/, '').trim();
    } catch {
        return '';
    }
}

function normalizeYelpBizUrl(url) {
    try {
        const parsed = new URL(url);
        return `https://www.yelp.com${parsed.pathname}`;
    } catch {
        return url;
    }
}

function stableId(prefix, locationId, index, text) {
    const base = Buffer.from(`${prefix}|${locationId}|${index}|${text}`).toString('base64');
    return `${prefix}_${base.replace(/[^a-z0-9]/gi, '').slice(0, 24)}`;
}

function normalizeUrlPath(url) {
    try {
        return new URL(url).pathname.toLowerCase();
    } catch {
        return '';
    }
}

function matchesRequiredTerms(text, terms = []) {
    const haystack = normalizeText(text).toLowerCase();
    return terms.every(term => haystack.includes(String(term).toLowerCase()));
}

function isAllowedGoogleReview(store, review) {
    const requiredTerms = store.google_required_terms || [];
    if (requiredTerms.length === 0) return true;

    return matchesRequiredTerms(review.resolved_location_name, requiredTerms);
}

function isAllowedYelpCard(store, card) {
    const path = normalizeUrlPath(card.review_url);
    const allowedPaths = store.yelp_allowed_paths || [];
    const pathAllowed = allowedPaths.length === 0 || allowedPaths.includes(path);
    if (!pathAllowed) return false;

    const combinedText = [card.title, card.snippet, card.scope_text].map(normalizeText).join(' ');
    const requiredTerms = store.yelp_required_terms || [];
    return matchesRequiredTerms(combinedText, requiredTerms);
}

async function extractGoogleSerp(page, query) {
    const url = `https://www.google.com/search?hl=en&gl=us&q=${encodeURIComponent(query)}`;
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(1500);

    return page.evaluate(() => {
        const norm = value => String(value || '').replace(/\s+/g, ' ').trim();
        const text = node => norm(node?.textContent || '');
        const links = Array.from(document.querySelectorAll('a'));
        const buttons = Array.from(document.querySelectorAll('button'));
        const images = Array.from(document.querySelectorAll('img'));

        const mapAnchor = links.find(link => (link.getAttribute('href') || '').includes('/maps/place/'));
        const reviewButton = buttons.find(button => /\d+\s+Google reviews/i.test(text(button)));

        function nearestScope(node, predicate) {
            let current = node;
            while (current) {
                const scopeText = text(current);
                if (scopeText && predicate(scopeText)) {
                    return current;
                }
                current = current.parentElement;
            }
            return node?.parentElement || node;
        }

        const summaryScope = mapAnchor
            ? nearestScope(mapAnchor, scopeText => scopeText.includes('Google reviews') && scopeText.length < 5000)
            : document.body;

        const googleReviewLinks = links.filter(link => (link.getAttribute('href') || '').includes('/maps/reviews/data'));
        const googleReviews = googleReviewLinks.slice(0, 5).map((link, index) => {
            const reviewScope = nearestScope(link, scopeText => scopeText.includes(text(link)) && scopeText.length < 800);
            const scopeText = text(reviewScope);
            const reviewerLink = Array.from(reviewScope?.querySelectorAll('a') || []).find(anchor => (anchor.getAttribute('href') || '').includes('/maps/contrib/'));
            const ratingImg = Array.from(reviewScope?.querySelectorAll('img') || []).find(img => norm(img.getAttribute('alt')).startsWith('Rated'));
            return {
                index,
                reviewer_name: text(reviewerLink),
                review_text: text(link).replace(/^"|"$/g, ''),
                review_url: link.href,
                rating_text: norm(ratingImg?.getAttribute('alt')),
                scope_text: scopeText,
            };
        }).filter(review => review.review_text);

        const yelpLinks = links.filter(link => (link.href || '').includes('yelp.com/biz'));
        const yelpCards = [];
        const seen = new Set();

        for (const link of yelpLinks) {
            const rawHref = link.href || '';
            let baseHref = rawHref.split('#')[0];
            try {
                const parsed = new URL(baseHref);
                baseHref = `https://www.yelp.com${parsed.pathname}`;
            } catch {
                // Keep original href when URL parsing fails in page context.
            }
            if (!baseHref || seen.has(baseHref)) continue;
            seen.add(baseHref);

            const cardScope = nearestScope(link, scopeText => scopeText.includes('Yelp') && scopeText.length < 2000);
            const scopeText = text(cardScope);
            const snippetLink = Array.from(cardScope?.querySelectorAll('a') || []).find(anchor => (anchor.href || '').includes(baseHref) && (anchor.href || '').includes('#:~:text='));
            const ratingImg = Array.from(cardScope?.querySelectorAll('img') || []).find(img => /Rated .* user reviews/i.test(norm(img.getAttribute('alt'))));

            yelpCards.push({
                title: text(link),
                review_url: baseHref,
                snippet: text(snippetLink),
                snippet_url: snippetLink?.href || '',
                rating_text: norm(ratingImg?.getAttribute('alt')),
                scope_text: scopeText,
            });
        }

        const googleSummaryText = reviewButton ? text(reviewButton) : text(summaryScope);
        const googleRatingImg = images.find(img => norm(img.getAttribute('alt')).startsWith('Rated') && img.closest('main'));
        const heading = text(summaryScope.querySelector('h2, h3')) || text(document.querySelector('h2, h3'));

        return {
            page_title: document.title,
            business_name: heading,
            google_summary_text: googleSummaryText,
            google_rating_text: norm(googleRatingImg?.getAttribute('alt')),
            google_reviews: googleReviews,
            yelp_cards: yelpCards,
        };
    });
}

async function extractGoogleReviewDetail(page, reviewUrl) {
    await page.goto(reviewUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(1200);

    return page.evaluate(() => {
        const norm = value => String(value || '').replace(/\s+/g, ' ').trim();
        const text = node => norm(node?.textContent || '');
        const main = document.querySelector('[role="main"]') || document.body;
        const actionButton = main.querySelector('button[aria-label^="Actions for "]');
        const actionLabel = actionButton?.getAttribute('aria-label') || '';
        const reviewerMatch = /^Actions for (.+?)'s review$/i.exec(actionLabel);
        const reviewerName = reviewerMatch?.[1] || '';
        const ratingNode = main.querySelector('[role="img"][aria-label*="stars"]');
        const dateNode = main.querySelector('span.rsqaWe')
            || Array.from(main.querySelectorAll('span, div')).find(node => /ago$|^\w+\s+\d{1,2},\s+\d{4}$/i.test(text(node)));
        const reviewTextNode = main.querySelector('span.wiI7pd')
            || Array.from(main.querySelectorAll('span.wiI7pd, div.wiI7pd, span, div')).find(node => {
                const value = text(node);
                if (value.length < 20) return false;
                if (/Order type|Meal type|Price per person|Recommended dishes|Parking|Place details/i.test(value)) return false;
                if (value === text(main.querySelector('.daF0l'))) return false;
                return true;
            });
        const placeName = text(main.querySelector('.daF0l')) || text(document.querySelector('title')).replace(/\s*-\s*Google Maps$/i, '');

        return {
            reviewer_name: reviewerName,
            rating_text: ratingNode?.getAttribute('aria-label') || '',
            review_date: text(dateNode),
            review_text: text(reviewTextNode),
            location_name: placeName,
        };
    });
}

function buildGoogleReviews(store, serpData) {
    const aggregateRating = parseNumericRating(serpData.google_rating_text || serpData.google_summary_text);
    const reviewCount = parseReviewCount(serpData.google_summary_text);

    return (serpData.google_reviews || [])
        .map((review, index) => ({
            gbp_review_id: stableId('browser_google', store.location_id, index, review.review_text),
            location_id: store.location_id,
            location_name: store.location_name,
            platform: 'google',
            rating: parseNumericRating(review.rating_text) || aggregateRating || 4,
            reviewer_name: review.reviewer_name || `Google reviewer ${index + 1}`,
            review_text: review.review_text,
            review_date: new Date().toISOString(),
            review_url: review.review_url,
            source: 'browser_fallback',
            source_quality: 'public_search_snippet',
            resolved_location_name: null,
            aggregate_rating: aggregateRating,
            aggregate_review_count: reviewCount,
        }));
}

async function fetchDirectGoogleReviews(page, store) {
    const directUrls = store.google_review_urls || [];
    const reviews = [];

    for (const [index, reviewUrl] of directUrls.entries()) {
        try {
            const detail = await extractGoogleReviewDetail(page, reviewUrl);
            if (!detail.review_text) continue;

            const review = {
                gbp_review_id: stableId('browser_google', store.location_id, index, reviewUrl),
                location_id: store.location_id,
                location_name: store.location_name,
                platform: 'google',
                rating: parseNumericRating(detail.rating_text) || 4,
                reviewer_name: detail.reviewer_name || `Google reviewer ${index + 1}`,
                review_text: detail.review_text,
                review_date: detail.review_date || new Date().toISOString(),
                review_url: reviewUrl,
                source: 'browser_fallback',
                source_quality: 'google_maps_review_page',
                resolved_location_name: detail.location_name || null,
                aggregate_rating: null,
                aggregate_review_count: null,
            };

            if (review.review_text.length >= 20 && isAllowedGoogleReview(store, review)) {
                reviews.push(review);
            }
        } catch {
            // Ignore individual direct review failures and keep other verified URLs.
        }
    }

    return reviews;
}

function buildYelpReviews(store, serpData) {
    function extractSnippet(card) {
        const fragmentSnippet = normalizeText(parseTextFragment(card.snippet_url));
        if (fragmentSnippet.length >= 20) return fragmentSnippet;

        const directSnippet = normalizeText(card.snippet);
        if (directSnippet.length >= 20 && !/^read more$/i.test(directSnippet)) return directSnippet;

        let scopeSnippet = normalizeText(card.scope_text);
        if (!scopeSnippet || /What Diners Love|Areas for Improvement|I can help you prepare/i.test(scopeSnippet)) {
            return '';
        }

        scopeSnippet = scopeSnippet
            .replace(/^.*?\b\d+\s+Reviews\b[:\s-]*/i, '')
            .replace(/^.*?\bReviews\b[:\s-]*/i, '')
            .replace(/^[*•]?\s*[A-Z][A-Za-z'.-]*(?:\s+[A-Z][A-Za-z'.-]*)?\s+\d+\s+(?:day|days|month|months|year|years)\s+ago\.\s*/i, '')
            .replace(/\bYelp\b.*$/i, '')
            .replace(/\s*Read more$/i, '')
            .trim();

        return scopeSnippet;
    }

    return (serpData.yelp_cards || [])
        .filter(card => isAllowedYelpCard(store, card))
        .slice(0, 5)
        .map((card, index) => {
        const cleanedSnippet = extractSnippet(card);
        return {
            gbp_review_id: stableId('browser_yelp', store.location_id, index, cleanedSnippet || card.title),
            location_id: store.location_id,
            location_name: store.location_name,
            platform: 'yelp',
            rating: parseNumericRating(card.rating_text) || 4,
            reviewer_name: `Yelp snippet ${index + 1}`,
            review_text: cleanedSnippet || normalizeText(card.scope_text),
            review_date: new Date().toISOString(),
            review_url: card.review_url,
            source: 'browser_fallback',
            source_quality: 'public_search_snippet',
            aggregate_rating: parseNumericRating(card.rating_text),
            aggregate_review_count: parseReviewCount(card.rating_text),
        };
        })
        .filter(review => review.review_text && review.review_text.length >= 12);
}

async function scrapeReviewsViaBrowser() {
    const playwright = resolvePlaywrightModule();
    const executablePath = resolveBrowserExecutable();
    const browser = await playwright.chromium.launch({
        executablePath,
        headless: true,
        args: [
            '--disable-blink-features=AutomationControlled',
            '--disable-dev-shm-usage',
            '--lang=en-US',
            '--no-sandbox',
        ],
    });

    const context = await browser.newContext({
        locale: 'en-US',
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36',
        viewport: { width: 1440, height: 1200 },
    });

    const reviews = [];
    const errors = [];

    try {
        for (const store of STORE_SOURCES) {
            const page = await context.newPage();
            try {
                let googleReviews = [];
                if ((store.google_review_urls || []).length > 0) {
                    googleReviews = await fetchDirectGoogleReviews(page, store);
                }

                if (googleReviews.length === 0 && store.google_query) {
                    const googleSerpData = await extractGoogleSerp(page, store.google_query);
                    googleReviews = buildGoogleReviews(store, googleSerpData);
                    for (const review of googleReviews) {
                        try {
                            const detail = await extractGoogleReviewDetail(page, review.review_url);
                            if (detail.reviewer_name) review.reviewer_name = detail.reviewer_name;
                            if (detail.rating_text) review.rating = parseNumericRating(detail.rating_text) || review.rating;
                            if (detail.review_text) review.review_text = detail.review_text;
                            if (detail.location_name) review.resolved_location_name = detail.location_name;
                            if (detail.review_date && detail.review_date.length < 40) review.review_date = detail.review_date;
                            review.source_quality = 'google_maps_review_page';
                        } catch {
                            // Keep the public SERP snippet when the detail page enrichment fails.
                        }
                    }
                    googleReviews = googleReviews
                        .filter(review => review.source_quality === 'google_maps_review_page')
                        .filter(review => review.review_text && review.review_text.length >= 20)
                        .filter(review => isAllowedGoogleReview(store, review));
                }

                const yelpReviews = process.env.REVIEW_ENABLE_YELP_BROWSER === '1' && store.yelp_query
                    ? buildYelpReviews(store, await extractGoogleSerp(page, store.yelp_query))
                    : [];
                reviews.push(...googleReviews, ...yelpReviews);
            } catch (err) {
                errors.push({ location: store.location_name, error: err.message });
            } finally {
                await page.close().catch(() => {});
            }
        }
    } finally {
        await context.close().catch(() => {});
        await browser.close().catch(() => {});
    }

    return {
        reviews,
        errors,
        locationCount: STORE_SOURCES.length,
        source: 'browser_fallback',
    };
}

module.exports = {
    scrapeReviewsViaBrowser,
};
