import assert from 'node:assert/strict';
import { OpenAiCampaignAnalysisProvider } from '../src/production/analysis/openai-campaign-analysis-provider.js';

(async () => {
    let callCount = 0;
    const retryingClient = {
        chat: {
            completions: {
                create: async () => {
                    callCount += 1;
                    if (callCount === 1) {
                        throw new Error('transient');
                    }
                    return {
                        choices: [{
                            finish_reason: 'stop',
                            message: {
                                content: JSON.stringify({
                                    recommendationType: 'KEEP',
                                    currentSetting: 'active | Spend $12.00 | Sales $120.00 | ROAS 10.00x',
                                    proposedSetting: 'Maintain current settings',
                                    expectedRoiImpact: 0,
                                    expectedProfitImpact: 0,
                                    confidence: 0.77,
                                    risk: 'low',
                                    reason: 'The campaign is profitable and stable.',
                                    rollbackPlan: 'No rollback required.',
                                    missingData: [],
                                }),
                            },
                        }],
                    };
                },
            },
        },
    };

    const provider = new OpenAiCampaignAnalysisProvider({
        apiKey: 'test',
        model: 'gpt-test',
        timeoutMs: 2000,
        client: retryingClient as any,
        retryPolicy: { attempts: 2, initialDelayMs: 1, backoffMultiplier: 1, maxDelayMs: 1 },
    });

    const recommendation = await provider.analyzeCampaign({
        store: {
            id: 'raw-sushi-bar',
            name: 'Raw Sushi Bar',
            email: 'raw@example.com',
            doorDashAccountId: '892006',
            active: true,
        },
        snapshot: {
            id: 'snapshot-1',
            storeId: 'raw-sushi-bar',
            campaignId: 'campaign-1',
            campaignName: 'Smart campaign',
            campaignType: 'promotion',
            status: 'active',
            weekStart: '2026-07-06',
            weekEndExclusive: '2026-07-13',
            snapshotSource: 'email_export',
            sourceRef: 'fixture.zip',
            batchId: 'batch-1',
            reportStartDate: '07/06/2026',
            reportEndDate: '07/13/2026',
            observedDateStart: '2026-07-06',
            observedDateEnd: '2026-07-12',
            orders: 3,
            sales: 120,
            spend: 12,
            roas: 10,
            startDate: '2026-06-24',
            endDate: null,
            dataCompleteness: 4,
            rawDataJson: '{}',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
        },
        currentBudget: null,
        estimatedProfit: 12,
        estimatedMargin: 0.1,
        previousSnapshot: null,
    });

    assert.equal(recommendation.recommendationType, 'KEEP');
    assert.equal(callCount, 2);

    const malformedProvider = new OpenAiCampaignAnalysisProvider({
        apiKey: 'test',
        model: 'gpt-test',
        timeoutMs: 2000,
        client: {
            chat: {
                completions: {
                    create: async () => ({
                        choices: [{
                            finish_reason: 'stop',
                            message: { content: '{"recommendationType":"KEEP"}' },
                        }],
                    }),
                },
            },
        } as any,
    });

    await assert.rejects(
        malformedProvider.analyzeCampaign({
            store: {
                id: 'raw-sushi-bar',
                name: 'Raw Sushi Bar',
                email: 'raw@example.com',
                doorDashAccountId: '892006',
                active: true,
            },
            snapshot: {
                id: 'snapshot-1',
                storeId: 'raw-sushi-bar',
                campaignId: 'campaign-1',
                campaignName: 'Smart campaign',
                campaignType: 'promotion',
                status: 'active',
                weekStart: '2026-07-06',
                weekEndExclusive: '2026-07-13',
                snapshotSource: 'email_export',
                sourceRef: 'fixture.zip',
                batchId: 'batch-1',
                reportStartDate: '07/06/2026',
                reportEndDate: '07/13/2026',
                observedDateStart: '2026-07-06',
                observedDateEnd: '2026-07-12',
                orders: 3,
                sales: 120,
                spend: 12,
                roas: 10,
                startDate: '2026-06-24',
                endDate: null,
                dataCompleteness: 4,
                rawDataJson: '{}',
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
            },
            currentBudget: null,
            estimatedProfit: 12,
            estimatedMargin: 0.1,
            previousSnapshot: null,
        }),
        /missing or empty|malformed|invalid/i,
    );

    console.log('production-openai tests passed');
})().catch((error) => {
    console.error(error);
    process.exit(1);
});
