const STORE_SOURCES = [
    {
        location_id: '4',
        location_name: 'Bakudan Ramen (Stone Oak)',
        google_query: 'Bakudan Ramen Stone Oak San Antonio TX reviews',
        google_required_terms: ['bakudan', 'ramen'],
        google_review_urls: [
            'https://www.google.com/maps/reviews/data=!4m5!14m4!1m3!1m2!1s102213835222270644757!2s0x865c8929f330b459:0x963aa4a02f9bfe0c?ved=1t:31295&ictx=111',
            'https://www.google.com/maps/reviews/data=!4m5!14m4!1m3!1m2!1s110067650511824922259!2s0x865c8929f330b459:0x963aa4a02f9bfe0c?ved=1t:31295&ictx=111',
            'https://www.google.com/maps/reviews/data=!4m5!14m4!1m3!1m2!1s116467350011941034422!2s0x865c8929f330b459:0x963aa4a02f9bfe0c?ved=1t:31295&ictx=111',
        ],
        yelp_query: 'Bakudan Ramen Stone Oak San Antonio TX Yelp reviews',
        yelp_allowed_paths: [
            '/biz/bakudan-ramen-san-antonio',
            '/biz/bakudan-ramen-san-antonio-2',
        ],
        yelp_required_terms: ['bakudan', 'ramen', 'san antonio'],
    },
    {
        location_id: '2',
        location_name: 'Bakudan Ramen (Bandera)',
        google_query: 'Bakudan Ramen Bandera San Antonio TX reviews',
        google_required_terms: ['bakudan', 'ramen'],
        google_review_urls: [
            'https://www.google.com/maps/reviews/data=!4m5!14m4!1m3!1m2!1s114755267216680821290!2s0x865c692073f87907:0x553c3db87d27c897?ved=1t:31295&ictx=111',
            'https://www.google.com/maps/reviews/data=!4m5!14m4!1m3!1m2!1s113173677278986757303!2s0x865c692073f87907:0x553c3db87d27c897?ved=1t:31295&ictx=111',
            'https://www.google.com/maps/reviews/data=!4m5!14m4!1m3!1m2!1s108391418622481774251!2s0x865c692073f87907:0x553c3db87d27c897?ved=1t:31295&ictx=111',
        ],
        yelp_query: 'Bakudan Ramen Bandera San Antonio TX Yelp reviews',
        yelp_allowed_paths: [
            '/biz/bakudan-ramen-san-antonio-3',
            '/biz/bakudan-ramen-san-antonio',
        ],
        yelp_required_terms: ['bakudan', 'ramen', 'san antonio'],
    },
    {
        location_id: '1',
        location_name: 'Raw Sushi Bistro',
        google_query: 'Raw Sushi Bistro San Antonio TX reviews',
        google_required_terms: ['raw', 'sushi', 'bistro'],
        google_review_urls: [],
        yelp_query: 'Raw Sushi Bistro San Antonio TX Yelp reviews',
        yelp_allowed_paths: [
            '/biz/raw-sushi-bistro-san-antonio',
        ],
        yelp_required_terms: ['raw', 'sushi', 'bistro', 'san antonio'],
    },
    {
        location_id: '3',
        location_name: 'Bakudan Ramen (The Rim)',
        google_query: 'Bakudan Ramen The Rim San Antonio TX reviews',
        google_required_terms: ['bakudan', 'ramen'],
        google_review_urls: [
            'https://www.google.com/maps/reviews/data=!4m5!14m4!1m3!1m2!1s110981558108553611099!2s0x865c653b5ded8f57:0xc0606df2315dcf58?ved=1t:31295&ictx=111',
            'https://www.google.com/maps/reviews/data=!4m5!14m4!1m3!1m2!1s100760193659759051175!2s0x865c653b5ded8f57:0xc0606df2315dcf58?ved=1t:31295&ictx=111',
            'https://www.google.com/maps/reviews/data=!4m5!14m4!1m3!1m2!1s106357195453490356071!2s0x865c653b5ded8f57:0xc0606df2315dcf58?ved=1t:31295&ictx=111',
        ],
        yelp_query: 'Bakudan Ramen The Rim San Antonio TX Yelp reviews',
        yelp_allowed_paths: [
            '/biz/bakudan-ramen-san-antonio-2',
            '/biz/bakudan-ramen-san-antonio-3',
            '/biz/bakudan-ramen-san-antonio',
        ],
        yelp_required_terms: ['bakudan', 'ramen', 'san antonio'],
    },
];

module.exports = {
    STORE_SOURCES,
};
