import OpenAI from 'openai';
import { runWithRetry, type RetryPolicy } from '../../automation/retry-policy.js';
import type { CampaignAnalysisInput, ProviderRecommendation } from '../types.js';
import type { CampaignAnalysisProvider } from './provider.js';

interface JsonSchemaResponseFormat {
    type: 'json_schema';
    json_schema: {
        name: string;
        strict: true;
        schema: Record<string, unknown>;
    };
}

interface OpenAiClientLike {
    chat: {
        completions: {
            create: (input: Record<string, unknown>, options?: Record<string, unknown>) => Promise<{
                choices?: Array<{
                    finish_reason?: string | null;
                    message?: {
                        content?: string | null;
                        refusal?: string | null;
                    };
                }>;
            }>;
        };
    };
}

const recommendationSchema: JsonSchemaResponseFormat = {
    type: 'json_schema',
    json_schema: {
        name: 'campaign_recommendation',
        strict: true,
        schema: {
            type: 'object',
            additionalProperties: false,
            required: [
                'recommendationType',
                'currentSetting',
                'proposedSetting',
                'expectedRoiImpact',
                'expectedProfitImpact',
                'confidence',
                'risk',
                'reason',
                'rollbackPlan',
                'missingData',
            ],
            properties: {
                recommendationType: {
                    type: 'string',
                    enum: ['INCREASE', 'DECREASE', 'PAUSE', 'RESUME', 'TEST', 'KEEP', 'REQUEST_MORE_DATA'],
                },
                currentSetting: { type: 'string' },
                proposedSetting: { type: 'string' },
                expectedRoiImpact: { anyOf: [{ type: 'number' }, { type: 'null' }] },
                expectedProfitImpact: { anyOf: [{ type: 'number' }, { type: 'null' }] },
                confidence: { type: 'number' },
                risk: {
                    type: 'string',
                    enum: ['low', 'medium', 'high'],
                },
                reason: { type: 'string' },
                rollbackPlan: { type: 'string' },
                missingData: {
                    type: 'array',
                    items: { type: 'string' },
                },
            },
        },
    },
};

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
    return new Promise<T>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`OpenAI request timed out after ${timeoutMs} ms.`)), timeoutMs);
        promise.then(
            value => {
                clearTimeout(timer);
                resolve(value);
            },
            error => {
                clearTimeout(timer);
                reject(error);
            },
        );
    });
}

function safeNumber(value: unknown): number | null {
    if (value === null) return null;
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export function validateProviderRecommendation(payload: unknown): ProviderRecommendation {
    if (!payload || typeof payload !== 'object') {
        throw new Error('OpenAI recommendation payload is missing.');
    }

    const candidate = payload as Record<string, unknown>;
    const recommendationType = String(candidate['recommendationType'] || '');
    const allowedTypes = new Set(['INCREASE', 'DECREASE', 'PAUSE', 'RESUME', 'TEST', 'KEEP', 'REQUEST_MORE_DATA']);
    if (!allowedTypes.has(recommendationType)) {
        throw new Error('OpenAI recommendationType is missing or invalid.');
    }

    const risk = String(candidate['risk'] || '');
    if (!['low', 'medium', 'high'].includes(risk)) {
        throw new Error('OpenAI risk is missing or invalid.');
    }

    const confidence = typeof candidate['confidence'] === 'number' ? candidate['confidence'] : Number.NaN;
    if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
        throw new Error('OpenAI confidence is missing or outside 0..1.');
    }

    const missingData = candidate['missingData'];
    if (!Array.isArray(missingData) || missingData.some(item => typeof item !== 'string')) {
        throw new Error('OpenAI missingData is malformed.');
    }

    const stringFields = ['currentSetting', 'proposedSetting', 'reason', 'rollbackPlan'] as const;
    for (const field of stringFields) {
        if (typeof candidate[field] !== 'string' || !String(candidate[field]).trim()) {
            throw new Error(`OpenAI ${field} is missing or empty.`);
        }
    }

    return {
        recommendationType: recommendationType as ProviderRecommendation['recommendationType'],
        currentSetting: String(candidate['currentSetting']),
        proposedSetting: String(candidate['proposedSetting']),
        expectedRoiImpact: safeNumber(candidate['expectedRoiImpact']),
        expectedProfitImpact: safeNumber(candidate['expectedProfitImpact']),
        confidence,
        risk: risk as ProviderRecommendation['risk'],
        reason: String(candidate['reason']),
        rollbackPlan: String(candidate['rollbackPlan']),
        missingData: missingData as string[],
    };
}

function defaultRetryPolicy(): RetryPolicy {
    return { attempts: 3, initialDelayMs: 1500, backoffMultiplier: 2, maxDelayMs: 12000 };
}

export class OpenAiCampaignAnalysisProvider implements CampaignAnalysisProvider {
    readonly providerName = 'openai';
    private readonly client: OpenAiClientLike;
    private readonly model: string;
    private readonly timeoutMs: number;
    private readonly retryPolicy: RetryPolicy;

    constructor(input: {
        apiKey: string;
        model: string;
        timeoutMs?: number;
        retryPolicy?: RetryPolicy;
        client?: OpenAiClientLike;
    }) {
        this.client = input.client || (new OpenAI({ apiKey: input.apiKey }) as unknown as OpenAiClientLike);
        this.model = input.model;
        this.timeoutMs = input.timeoutMs || 30000;
        this.retryPolicy = input.retryPolicy || defaultRetryPolicy();
    }

    async analyzeCampaign(input: CampaignAnalysisInput): Promise<ProviderRecommendation> {
        const userPayload = {
            store: {
                id: input.store.id,
                name: input.store.name,
                doorDashAccountId: input.store.doorDashAccountId,
            },
            campaign: {
                id: input.snapshot.campaignId,
                name: input.snapshot.campaignName,
                type: input.snapshot.campaignType,
                status: input.snapshot.status,
                weekStart: input.snapshot.weekStart,
                weekEndExclusive: input.snapshot.weekEndExclusive,
                orders: input.snapshot.orders,
                sales: input.snapshot.sales,
                spend: input.snapshot.spend,
                roas: input.snapshot.roas,
                observedDateStart: input.snapshot.observedDateStart,
                observedDateEnd: input.snapshot.observedDateEnd,
            },
            priorWeekCampaign: input.previousSnapshot
                ? {
                    weekStart: input.previousSnapshot.weekStart,
                    orders: input.previousSnapshot.orders,
                    sales: input.previousSnapshot.sales,
                    spend: input.previousSnapshot.spend,
                    roas: input.previousSnapshot.roas,
                }
                : null,
            economics: {
                currentBudget: input.currentBudget,
                estimatedProfit: input.estimatedProfit,
                estimatedMargin: input.estimatedMargin,
            },
        };

        const systemPrompt = [
            'You are the production analysis provider for weekly DoorDash campaign optimization.',
            'Return exactly one JSON object that follows the supplied schema.',
            'Do not include markdown or extra commentary.',
            'Prefer KEEP or REQUEST_MORE_DATA when the evidence is incomplete.',
            'Only recommend INCREASE when ROAS and estimated profit are both strong.',
            'Only recommend PAUSE or DECREASE when profitability or efficiency is clearly poor.',
            'Use missingData to name every material gap that reduces confidence.',
        ].join(' ');

        const response = await runWithRetry(async () => {
            const request = this.client.chat.completions.create({
                model: this.model,
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: JSON.stringify(userPayload) },
                ],
                response_format: recommendationSchema,
            }, {
                timeout: this.timeoutMs,
            });
            return withTimeout(request, this.timeoutMs + 1000);
        }, this.retryPolicy);

        const choice = response.choices?.[0];
        if (!choice) {
            throw new Error('OpenAI response did not include any choices.');
        }
        if (choice.message?.refusal) {
            throw new Error(`OpenAI refused the campaign analysis request: ${choice.message.refusal}`);
        }
        if (choice.finish_reason && choice.finish_reason !== 'stop') {
            throw new Error(`OpenAI response was incomplete (finish_reason=${choice.finish_reason}).`);
        }
        const content = choice.message?.content;
        if (!content) {
            throw new Error('OpenAI response content is missing.');
        }

        let parsed: unknown;
        try {
            parsed = JSON.parse(content);
        } catch (error) {
            throw new Error(`OpenAI response JSON could not be parsed: ${(error as Error).message}`);
        }
        return validateProviderRecommendation(parsed);
    }
}
