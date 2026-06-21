/**
 * handwriting/index.js — Main Handwriting Memory Module
 * 
 * Unified entry point for all handwriting memory functionality.
 */

const { initHandwritingTables } = require("./dbSchema");
const cellCropStorage = require("./cellCropStorage");
const confirmedSamples = require("./confirmedSamples");
const featureExtraction = require("./featureExtraction");
const memorySearch = require("./memorySearch");
const predictionEngine = require("./predictionEngine");
const sampleImporter = require("./sampleImporter");
const handwritingApi = require("./api");

module.exports = {
    initHandwritingTables,
    cellCropStorage,
    confirmedSamples,
    featureExtraction,
    memorySearch,
    predictionEngine,
    sampleImporter,
    handwritingApi,
};
