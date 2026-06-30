// Test cases for Review Reply Agent — Case A through F per CEO directive.
// Validates classification, aspect detection, reply generation, quality check.

const pipeline = require('../review-agent/pipeline');
const { qualityCheck } = require('../review-agent/reply-engine');

const TEST_CASES = [
    {
        id: 'A',
        name: 'Simple positive',
        input: {
            store_id: 'bakudan_rim',
            platform: 'google',
            rating: 5,
            review_text: 'Amazing ramen and great service.',
            reviewer_name: 'Alice',
        },
        expected: {
            auto_reply_allowed: true,
            sentiment: 'positive',
        },
    },
    {
        id: 'B',
        name: 'Positive with detail',
        input: {
            store_id: 'bakudan_rim',
            platform: 'google',
            rating: 5,
            review_text: 'The spicy miso ramen was excellent and our server was super friendly.',
            reviewer_name: 'Bob',
        },
        expected: {
            auto_reply_allowed: true,
            sentiment: 'positive',
            mentions_items: ['spicy miso ramen'],
        },
    },
    {
        id: 'C',
        name: 'Mixed review',
        input: {
            store_id: 'bakudan_rim',
            platform: 'google',
            rating: 3,
            review_text: 'Food was good but the ramen came out late and the server didn\'t check on us.',
            reviewer_name: 'John',
        },
        expected: {
            auto_reply_allowed: false,
            risk_level: 'approval_required',
            sentiment: 'mixed',
        },
    },
    {
        id: 'D',
        name: 'Negative review',
        input: {
            store_id: 'bakudan_rim',
            platform: 'google',
            rating: 1,
            review_text: 'Terrible service and dirty table.',
            reviewer_name: 'Karen',
        },
        expected: {
            auto_reply_allowed: false,
            risk_level: 'escalation_required',
        },
    },
    {
        id: 'E',
        name: 'Sensitive review',
        input: {
            store_id: 'bakudan_rim',
            platform: 'google',
            rating: 2,
            review_text: 'I got sick after eating here.',
            reviewer_name: 'Anonymous',
        },
        expected: {
            auto_reply_allowed: false,
            risk_level: 'escalation_required',
        },
    },
    {
        id: 'F',
        name: 'Delivery issue',
        input: {
            store_id: 'bakudan_rim',
            platform: 'doordash',
            rating: 2,
            review_text: 'My DoorDash order was missing items and everything was cold.',
            reviewer_name: 'Mike',
        },
        expected: {
            auto_reply_allowed: false,
            risk_level: 'escalation_required', // 2★ forces escalation (matches directive: 'escalation_required OR manager approval')
        },
    },
];

function runTests() {
    console.log('═'.repeat(80));
    console.log('  REVIEW REPLY AGENT — TEST SUITE');
    console.log('═'.repeat(80));
    console.log('');

    const results = [];
    for (const tc of TEST_CASES) {
        console.log(`\n┌─ Case ${tc.id}: ${tc.name}`);
        console.log(`│  Input: ${tc.input.rating}★ "${tc.input.review_text.slice(0, 60)}..."`);
        console.log(`│  Reviewer: ${tc.input.reviewer_name}`);

        try {
            const generated = pipeline.generate(tc.input);
            const analysis = generated.analysis;
            const qc = generated.quality_check;

            console.log(`│`);
            console.log(`│  Sentiment: ${analysis.sentiment} (${analysis.sentiment_detail.score})`);
            console.log(`│  Aspects:   ${analysis.aspects.join(', ') || '(none)'}`);
            console.log(`│  Risk:      ${analysis.risk_level}`);
            console.log(`│  Auto OK:   ${analysis.auto_reply_allowed}`);
            console.log(`│  Quality:   ${qc.passed ? '✅ PASS' : '❌ FAIL'} (length=${qc.length})`);
            console.log(`│  Mentions:  ${(generated.mentioned_items || []).join(', ') || '(none)'}`);
            console.log(`│`);
            console.log(`│  Draft reply:`);
            for (const line of String(generated.draft_reply).split('\n').slice(0, 4)) {
                console.log(`│    ${line}`);
            }
            if (String(generated.draft_reply).split('\n').length > 4) console.log(`│    ...`);

            // Validate expectations
            const checks = [];
            if (tc.expected.auto_reply_allowed !== undefined) {
                checks.push({
                    name: 'auto_reply_allowed',
                    pass: analysis.auto_reply_allowed === tc.expected.auto_reply_allowed,
                    got: analysis.auto_reply_allowed,
                    expected: tc.expected.auto_reply_allowed,
                });
            }
            if (tc.expected.risk_level) {
                checks.push({
                    name: 'risk_level',
                    pass: analysis.risk_level === tc.expected.risk_level,
                    got: analysis.risk_level,
                    expected: tc.expected.risk_level,
                });
            }
            if (tc.expected.sentiment) {
                checks.push({
                    name: 'sentiment',
                    pass: analysis.sentiment === tc.expected.sentiment,
                    got: analysis.sentiment,
                    expected: tc.expected.sentiment,
                });
            }
            if (tc.expected.mentions_items) {
                const allMentioned = tc.expected.mentions_items.every(item =>
                    (generated.mentioned_items || []).some(m => m.includes(item) || item.includes(m))
                );
                checks.push({
                    name: 'mentions_items',
                    pass: allMentioned,
                    got: (generated.mentioned_items || []).join(','),
                    expected: tc.expected.mentions_items.join(','),
                });
            }

            // Quality check
            checks.push({
                name: 'quality_check',
                pass: qc.passed,
                got: qc.passed ? 'PASS' : `FAIL: ${qc.issues.join('; ')}`,
                expected: 'PASS',
            });

            const allPass = checks.every(c => c.pass);
            console.log(`│`);
            console.log(`│  Checks:`);
            for (const c of checks) {
                console.log(`│    ${c.pass ? '✅' : '❌'} ${c.name}: got "${c.got}" expected "${c.expected}"`);
            }
            console.log(`│`);
            console.log(`└─ Result: ${allPass ? '✅ PASS' : '❌ FAIL'}`);

            results.push({
                id: tc.id,
                name: tc.name,
                pass: allPass,
                checks,
            });
        } catch (err) {
            console.log(`└─ ❌ ERROR: ${err.message}`);
            results.push({ id: tc.id, name: tc.name, pass: false, error: err.message });
        }
    }

    console.log('\n' + '═'.repeat(80));
    console.log('  SUMMARY');
    console.log('═'.repeat(80));
    const passed = results.filter(r => r.pass).length;
    const total = results.length;
    console.log(`  ${passed}/${total} test cases passed`);
    for (const r of results) {
        console.log(`    ${r.pass ? '✅' : '❌'} Case ${r.id}: ${r.name}${r.error ? ` — ${r.error}` : ''}`);
    }

    return { passed, total, results };
}

if (require.main === module) {
    const result = runTests();
    process.exit(result.passed === result.total ? 0 : 1);
}

module.exports = { runTests, TEST_CASES };