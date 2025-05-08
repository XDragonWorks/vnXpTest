const VNDB_API_ENDPOINT = 'https://api.vndb.org/kana';
const APP_VERSION = "1.2.0";

// --- State Variables ---
let currentUserId = '';
let currentVNLabels = [];
let currentCharacterFilters = {
    gender: 'any',
    role: 'any'
};
let currentUserGenderPreference = 'any';
let currentSamplingRate = 100;

let allUserVNs = [];
let potentialTestCharacters = [];
let testCharacters = [];
let addedCharacterIds = new Set();

let currentCharacterIndex = -1;
let userRatings = [];

let translations = {};
let isLoadingNextChunk = false;
let allChunksLoaded = false;
const CHARS_PER_VN_BATCH_FETCH = 20;
const MIN_RELIABLE_COUNT_DEFAULT = 3; // 默认值，将被策略覆盖

let currentStrategy = null;
let availableStrategies = [{
    "name": "默认策略",
    "version": "1.0.0",
    "description": "默认的均衡策略",
    "path": "default.json"
}];
let enableSpoilers = false;
let filterSexualTraits = false;


// --- DOM Elements ---
const pages = {
    start: document.getElementById('start-page'),
    test: document.getElementById('test-page'),
    results: document.getElementById('results-page'),
};
const loadingOverlay = document.getElementById('loading-overlay');
const loadingOverlayMessage = document.getElementById('loading-overlay-message');
const userIdInput = document.getElementById('vndbUserId');
const vndbLabelsContainer = document.getElementById('vndbLabelsContainer');
const vndbLabelsOtherInput = document.getElementById('vndbLabelsOther');
const filterGenderSelect = document.getElementById('filterGender');
const filterRoleSelect = document.getElementById('filterRole');
const userGenderPreferenceSelect = document.getElementById('userGenderPreference');
const samplingPercentageInput = document.getElementById('samplingPercentage');
const strategySelect = document.getElementById('strategySelect');
const enableSpoilersSelect = document.getElementById('enableSpoilers');
const filterSexualTraitsSelect = document.getElementById('filterSexualTraits');

const startButton = document.getElementById('startButton');
const loadProgressButton = document.getElementById('loadProgressButton');
const importReportButton = document.getElementById('importReportButton');
const characterCountDisplay = document.getElementById('character-count-display');
const backgroundLoadingStatus = document.getElementById('background-loading-status');
const characterDisplayContainer = document.getElementById('character-display-container');
const skipButton = document.getElementById('skipButton');
const backButton = document.getElementById('backButton');
const saveProgressButton = document.getElementById('saveProgressButton');
const quitTestButton = document.getElementById('quitTestButton');
const resultsSummary = document.getElementById('results-summary');
const sortResultsBySelect = document.getElementById('sortResultsBy');
const countFilterInput = document.getElementById('countFilter');
const traitScoresDisplayContainer = document.getElementById('trait-scores-display-container');
const exportReportResultsButton = document.getElementById('exportReportButton');
const backToStartButton = document.getElementById('backToStartButton');
// 模态框元素
let customModalOverlay;
let customModal;
let customModalTitle;
let customModalMessage;
let customModalButtons;
let customModalConfirm;
let customModalCancel;


// --- API Cache ---
const apiCache = {
    ulist: {},
    character: {},
};
const CACHE_DURATION_ULIST = 5 * 60 * 1000;
const CACHE_DURATION_CHARACTER_BATCH = 30 * 60 * 1000;

// --- Initialization ---
document.addEventListener('DOMContentLoaded', async () => {
    customModalOverlay = document.getElementById('custom-modal-overlay');
    customModal = document.getElementById('custom-modal');
    customModalTitle = document.getElementById('custom-modal-title');
    customModalMessage = document.getElementById('custom-modal-message');
    customModalButtons = document.getElementById('custom-modal-buttons');
    customModalConfirm = document.getElementById('custom-modal-confirm');
    customModalCancel = document.getElementById('custom-modal-cancel');

    document.getElementById('version-footer').innerText = `vnXpTest v${APP_VERSION}`;

    showLoading(true, 'Init', '正在初始化');
    await Promise.all([
        loadStrategies(),
        loadTranslations()
    ]);
    populateStrategySelect(); // 填充策略下拉框
    setupEventListeners();
    navigateTo('start', true);
    showLoading(false);
});

// --- 翻译函数 ---
async function loadTranslations() {
    try {
        const response = await fetch('translate.json');
        if (!response.ok) {
            console.warn('translate.json not found or could not be loaded. Using original text.');
            translations = {};
            return;
        }
        translations = await response.json();
    } catch (error) {
        console.error('Error loading translations:', error);
        translations = {};
    }
}

function getTranslation(key, fallback = null, params = null) {
    let translated = translations[key] || fallback || key;
    if (params && typeof translated === 'string') {
        for (const paramKey in params) {
            translated = translated.replace(`{${paramKey}}`, params[paramKey]);
        }
    }
    return translated;
}


// --- 策略加载与处理 ---
async function loadStrategies() {
    try {
        const response = await fetch('strategies/manifest.json');
        if (!response.ok) {
            console.warn('strategies/manifest.json not found or could not be loaded. Using built-in manifest.');
            return;
        }
        strategies = await response.json();
    } catch (error) {
        console.error('Error loading strategies manifest:', error);
        strategies = {};
    }
}

function populateStrategySelect() {
    if (!strategySelect) return;
    strategySelect.innerHTML = ''; // 清空现有选项
    availableStrategies.forEach(strategy => {
        const option = document.createElement('option');
        option.value = strategy.path;
        option.textContent = strategy.name;
        strategySelect.appendChild(option);
    });
}

async function loadStrategy(strategyPath) {
    try {
        const response = await fetch("strategies/" + strategyPath);
        if (!response.ok) {
            throw new Error(`Failed to load strategy: ${response.statusText}`);
        }
        const strategyData = await response.json();
        console.log("Strategy loaded:", strategyData.strategyName);
        return strategyData;
    } catch (error) {
        console.error('Error loading strategy:', error);
        showCustomAlert(getTranslation('ErrorLoadingStrategy', '加载评分策略失败: {errorMsg}', { errorMsg: error.message }), getTranslation('Error', '错误'));
        return null;
    }
}


// --- 事件监听器 ---
function setupEventListeners() {
    startButton.addEventListener('click', handleStartTest);
    loadProgressButton.addEventListener('click', loadProgress);
    importReportButton.addEventListener('click', () => {
        const fileInput = document.createElement('input');
        fileInput.type = 'file';
        fileInput.accept = '.json';
        fileInput.onchange = (e) => importReportFromFile(e.target.files[0]);
        fileInput.click();
    });
    skipButton.addEventListener('click', handleSkipCharacter);
    backButton.addEventListener('click', displayPreviousCharacter);
    saveProgressButton.addEventListener('click', saveProgress);
    quitTestButton.addEventListener('click', () => {
        showCustomConfirm(
            getTranslation('ConfirmQuitTest', '确定要退出当前测试吗？未保存的进度将会丢失。'),
            getTranslation('ConfirmQuitTitle', '退出确认'),
            () => {
                finishTest(true);
            }
        );
    });

    const reCalculateAndDisplayTraitScores = () => {
        const ratedChars = userRatings.filter(r => !r.skipped);
        if (ratedChars.length > 0 && currentStrategy) {
            calculateAndDisplayTraitScores(ratedChars);
        }
    };
    sortResultsBySelect.addEventListener('change', reCalculateAndDisplayTraitScores);
    countFilterInput.addEventListener('change', reCalculateAndDisplayTraitScores);

    const exportBtn = document.getElementById('exportReportButton');
    if (exportBtn) {
        exportBtn.addEventListener('click', exportReport);
    } else {
        console.error("Export report button (#exportReportButton) not initially found.");
    }
    backToStartButton.addEventListener('click', () => navigateTo('start'));
    document.querySelectorAll('button').forEach(button => {
        button.addEventListener('click', addRippleEffect);
    });

    if (customModalCancel) {
        customModalCancel.addEventListener('click', () => {
            customModalOverlay.classList.remove('active');
            if (typeof confirmCallback === 'function') {
                customModalConfirm.removeEventListener('click', confirmCallback);
            }
            if (typeof alertCallback === 'function') {
                customModalConfirm.removeEventListener('click', alertCallback);
            }
            confirmCallback = null;
            alertCallback = null;
        });
    } else {
        console.error("Custom modal cancel button not found during setup.");
    }
}

// --- Navigation & UI ---
function navigateTo(pageKey, isInitialLoad = false) {
    let currentlyActivePage = null;
    Object.values(pages).forEach(p => {
        if (p.classList.contains('active')) {
            currentlyActivePage = p;
        }
        p.classList.remove('exiting');
    });
    const targetPage = pages[pageKey];
    if (!targetPage) {
        console.error("Target page not found:", pageKey);
        return;
    }
    if (currentlyActivePage === targetPage && !isInitialLoad) {
        return;
    }

    if (currentlyActivePage && currentlyActivePage !== targetPage) {
        currentlyActivePage.classList.add('exiting');
        currentlyActivePage.classList.remove('active');
        const handleExitAnimationEnd = function () {
            this.classList.remove('exiting');
            this.style.display = 'none';
            this.removeEventListener('animationend', handleExitAnimationEnd);
            if (!targetPage.classList.contains('active')) {
                targetPage.style.display = 'flex';
                targetPage.classList.add('active');
            }
        };
        currentlyActivePage.addEventListener('animationend', handleExitAnimationEnd);
    } else {
        Object.values(pages).forEach(p => {
            if (p !== targetPage) p.style.display = 'none';
        });
        targetPage.style.display = 'flex';
        targetPage.classList.add('active');
    }
    if (pageKey === 'start' && !isInitialLoad) {
        resetFullState();
    } else if (isInitialLoad && pageKey === 'start') {
        resetFullState(); // 初始加载也重置状态
    }
}

function showLoading(isLoading, messageKey = 'Loading', messageFallback = "正在加载...") {
    if (!loadingOverlay || !loadingOverlayMessage) return;
    loadingOverlayMessage.textContent = getTranslation(messageKey, messageFallback);
    loadingOverlay.classList.toggle('active', isLoading);
}

function updateCharacterCountDisplay() {
    const currentPosition = currentCharacterIndex >= 0 ? currentCharacterIndex + 1 : 0;
    let statusText = `(${getTranslation('Loaded', '已加载')} ${testCharacters.length}`;
    if (!allChunksLoaded) {
        statusText += ` ${getTranslation('LoadingInBackgroundShort', '后台加载中...')})`;
    } else {
        statusText += ` ${getTranslation('Total', '总计')})`;
    }
    characterCountDisplay.textContent = `${getTranslation('CharacterProgress', '角色')}: ${currentPosition} / ${testCharacters.length} ${statusText}`;
}

function addRippleEffect(event) {
    const button = event.currentTarget;
    if (!button) return;
    const ripple = document.createElement("span");
    const rect = button.getBoundingClientRect();
    const size = Math.max(rect.width, rect.height);
    ripple.style.width = ripple.style.height = `${size}px`;
    ripple.style.left = `${event.clientX - rect.left - size / 2}px`;
    ripple.style.top = `${event.clientY - rect.top - size / 2}px`;
    ripple.classList.add("ripple");
    const existingRipple = button.querySelector(".ripple");
    if (existingRipple) existingRipple.remove();
    button.appendChild(ripple);
    ripple.addEventListener('animationend', () => ripple.remove(), {
        once: true
    });
}

let confirmCallback = null;
let alertCallback = null;

function showCustomConfirm(message, title = getTranslation("Confirm", "确认"), onConfirm = () => { }, onCancel = () => { }) {
    if (!customModalOverlay || !customModalTitle || !customModalMessage || !customModalConfirm || !customModalCancel) {
        console.error("Custom modal elements not found!");
        if (confirm(message)) onConfirm(); else onCancel();
        return;
    }
    customModalTitle.textContent = title;
    customModalMessage.textContent = message;
    customModalCancel.style.display = '';
    customModalConfirm.style.display = '';
    customModalConfirm.textContent = getTranslation('Confirm', '确认');

    if (typeof confirmCallback === 'function') {
        customModalConfirm.removeEventListener('click', confirmCallback);
    }
    if (typeof alertCallback === 'function') { // Also clear alert if any
        customModalConfirm.removeEventListener('click', alertCallback);
    }

    confirmCallback = () => {
        customModalOverlay.classList.remove('active');
        onConfirm();
        confirmCallback = null;
    };
    customModalConfirm.addEventListener('click', confirmCallback, { once: true });

    // Also handle cancel button click
    const cancelHandler = () => {
        customModalOverlay.classList.remove('active');
        onCancel();
        customModalCancel.removeEventListener('click', cancelHandler, { once: true });
        if (confirmCallback) customModalConfirm.removeEventListener('click', confirmCallback); // clean up confirm if cancel clicked
        confirmCallback = null;
    };
    customModalCancel.addEventListener('click', cancelHandler, { once: true });

    customModalOverlay.classList.add('active');
}

function showCustomAlert(message, title = getTranslation("Info", "提示")) {
    if (!customModalOverlay || !customModalTitle || !customModalMessage || !customModalConfirm || !customModalCancel) {
        alert(message);
        return;
    }
    customModalTitle.textContent = title;
    customModalMessage.textContent = message;
    customModalCancel.style.display = 'none';
    customModalConfirm.style.display = '';
    customModalConfirm.textContent = getTranslation('OK', '确定');

    if (typeof confirmCallback === 'function') {
        customModalConfirm.removeEventListener('click', confirmCallback);
    }
    if (typeof alertCallback === 'function') {
        customModalConfirm.removeEventListener('click', alertCallback);
    }
    alertCallback = () => {
        customModalOverlay.classList.remove('active');
        alertCallback = null;
    };
    customModalConfirm.addEventListener('click', alertCallback, { once: true });
    customModalOverlay.classList.add('active');
}

// --- Core Test Logic ---
async function handleStartTest() {
    currentUserId = userIdInput.value.trim();
    if (!currentUserId) {
        showCustomAlert(getTranslation('ErrorUserIDRequired', '请输入 VNDB 用户 ID！'), getTranslation('Error', '错误'));
        return;
    }

    const selectedStrategyPath = strategySelect.value;
    currentStrategy = await loadStrategy(selectedStrategyPath);
    if (!currentStrategy) {
        showCustomAlert(getTranslation('ErrorStrategyNotLoaded', '未能加载评分策略，无法开始测试。'), getTranslation('Error', '错误'));
        return;
    }

    enableSpoilers = enableSpoilersSelect.value === 'true';
    filterSexualTraits = filterSexualTraitsSelect.value === 'true';

    const selectedLabelCheckboxes = Array.from(vndbLabelsContainer.querySelectorAll('input[name="vndbLabel"]:checked')).map(cb => parseInt(cb.value, 10));
    const otherLabelIds = vndbLabelsOtherInput.value.trim() ? vndbLabelsOtherInput.value.split(',').map(id => parseInt(id.trim(), 10)).filter(id => !isNaN(id) && id > 0) : [];
    currentVNLabels = [...new Set([...selectedLabelCheckboxes, ...otherLabelIds])];
    if (currentVNLabels.length === 0) {
        const defaultPlayedCheckbox = vndbLabelsContainer.querySelector('input[value="2"]');
        if (defaultPlayedCheckbox) defaultPlayedCheckbox.value = 'true';
        currentVNLabels = [2]; // Default to "Played"
        showCustomAlert(getTranslation('ErrorNoLabelsSelected', '未选择任何标签，已默认使用“玩过 (2)”。'), getTranslation('Warning', '警告'));
    }
    currentCharacterFilters.gender = filterGenderSelect.value;
    currentCharacterFilters.role = filterRoleSelect.value;
    currentUserGenderPreference = userGenderPreferenceSelect.value;
    currentSamplingRate = parseInt(samplingPercentageInput.value, 10);
    if (isNaN(currentSamplingRate) || currentSamplingRate < 1 || currentSamplingRate > 100) {
        showCustomAlert(getTranslation('ErrorSamplingRate', '抽样比例必须在 1 到 100 之间。'), getTranslation('Error', '错误'));
        currentSamplingRate = 100;
        samplingPercentageInput.value = 100;
    }

    resetTestState();
    showLoading(true, 'LoadingVNList', '正在获取您的 VN 列表...');
    navigateTo('test');
    try {
        allUserVNs = await fetchUserVNList(currentUserId, currentVNLabels);
        if (!allUserVNs || allUserVNs.length === 0) {
            showCustomAlert(getTranslation('ErrorFetchVNListFailed', '未能获取到该用户的 VN 列表，或列表为空。请检查用户 ID 或标签设置。'), getTranslation('Error', '错误'));
            showLoading(false);
            navigateTo('start');
            return;
        }
        backgroundLoadingStatus.textContent = `${getTranslation('FetchedVNs', '已获取 {count} 部 VN。', { count: allUserVNs.length })} ${getTranslation('FetchingCharacters', '开始获取角色...')}`;
        streamCharacters();
    } catch (error) {
        console.error('测试初始化过程中发生错误:', error);
        showCustomAlert(`${getTranslation('ErrorDuringTestInit', '发生错误')}: ` + (error.message || error), getTranslation('Error', '错误'));
        showLoading(false);
        navigateTo('start');
    }
}

function resetTestState() {
    allUserVNs = [];
    potentialTestCharacters = [];
    testCharacters = [];
    addedCharacterIds.clear();
    userRatings = [];
    currentCharacterIndex = -1;
    isLoadingNextChunk = false;
    allChunksLoaded = false;
    characterDisplayContainer.innerHTML = `<p>${getTranslation('PreparingCharacterData', '正在准备角色数据...')}</p>`;
    backgroundLoadingStatus.textContent = '';
    updateCharacterCountDisplay();
    backButton.disabled = true;
    // currentStrategy 保持加载的值，不在这里重置
}

function resetFullState() { // 完全重置，回到初始页面时调用
    resetTestState();
    currentStrategy = null; // 重置策略
    enableSpoilers = false;
    filterSexualTraits = false;

    userIdInput.value = '';
    vndbLabelsContainer.querySelectorAll('input[name="vndbLabel"]').forEach(cb => cb.checked = (cb.value === '2')); // Default "Played"
    vndbLabelsOtherInput.value = '';
    filterGenderSelect.value = 'any';
    filterRoleSelect.value = 'any';
    userGenderPreferenceSelect.value = 'any';
    samplingPercentageInput.value = '100';
    if (enableSpoilersSelect) enableSpoilersSelect.value = 'true';
    if (filterSexualTraitsSelect) filterSexualTraitsSelect.value = 'false';
    if (strategySelect && availableStrategies.length > 0) strategySelect.value = availableStrategies[0].path; // 重置为默认策略

}

// --- 流式加载与抽样逻辑修改 ---
async function streamCharacters() {
    let vnIdx = 0;
    const totalVNs = allUserVNs.length;
    testCharacters = [];
    addedCharacterIds.clear();
    let testStarted = false;

    async function fetchNextChunk() {
        if (vnIdx >= totalVNs || isLoadingNextChunk || allChunksLoaded) {
            if (vnIdx >= totalVNs && !allChunksLoaded) {
                allChunksLoaded = true;
                backgroundLoadingStatus.textContent = getTranslation('AllCharactersLoaded', '所有角色已加载完毕!');
                if (!testStarted && testCharacters.length === 0) {
                    showLoading(false);
                    backgroundLoadingStatus.textContent = getTranslation('NoMatchingCharactersFound', '未找到符合条件的角色。');
                    showCustomAlert(getTranslation('ErrorNoCharsAfterFilter', '根据筛选条件，没有找到符合的角色。请尝试更宽松的条件。'), getTranslation('Info', '提示'));
                    navigateTo('start');
                } else if (!testStarted && testCharacters.length > 0) {
                    showLoading(false);
                }
                updateCharacterCountDisplay();
            }
            return;
        }

        isLoadingNextChunk = true;
        const vnBatch = allUserVNs.slice(vnIdx, vnIdx + CHARS_PER_VN_BATCH_FETCH);
        const currentBatchStartIdx = vnIdx;
        vnIdx += CHARS_PER_VN_BATCH_FETCH;

        if (vnBatch.length > 0) {
            const progressMsg = getTranslation('ProcessingVNsProgress', '正在处理 VN {start}-{end} / {total}...', { start: currentBatchStartIdx + 1, end: Math.min(vnIdx, totalVNs), total: totalVNs });
            if (!testStarted) {
                showLoading(true, '', progressMsg); // Use actual message, not key
            } else {
                backgroundLoadingStatus.textContent = progressMsg;
            }

            try {
                const charactersFromBatch = await fetchCharactersFromVNsWithCache(vnBatch.map(vn => vn.id));
                const newlyFilteredChars = processAndFilterCharacters(charactersFromBatch, allUserVNs);

                let sampledNewChars = [];
                if (currentSamplingRate < 100) {
                    shuffleArray(newlyFilteredChars);
                    const countToSample = Math.ceil(newlyFilteredChars.length * (currentSamplingRate / 100));
                    sampledNewChars = newlyFilteredChars.slice(0, countToSample);
                } else {
                    sampledNewChars = newlyFilteredChars;
                }

                sampledNewChars.forEach(char => {
                    if (!addedCharacterIds.has(char.id)) {
                        testCharacters.push(char);
                        addedCharacterIds.add(char.id);
                    }
                });

                if (!testStarted && testCharacters.length > 0) {
                    testStarted = true;
                    shuffleArray(testCharacters);
                    currentCharacterIndex = 0;
                    showLoading(false);
                    displayCharacter(testCharacters[currentCharacterIndex]);
                    backgroundLoadingStatus.textContent = getTranslation('LoadingRemainingCharsInBackground', '正在后台加载其余角色...');
                }
                updateCharacterCountDisplay();

            } catch (e) {
                console.error(`获取 VN 批次角色失败: `, e);
                backgroundLoadingStatus.textContent = getTranslation('ErrorLoadingCharBatch', '批次角色加载失败，仍在继续...');
            }
        }
        isLoadingNextChunk = false;
        requestAnimationFrame(fetchNextChunk); // Continue fetching
    }
    await fetchNextChunk(); // Start the first chunk
}


function processAndFilterCharacters(rawCharacters, allVnsMap) {
    const vnMap = new Map(allVnsMap.map(vn => [vn.id, {
        title: vn.title,
        originalTitle: vn.originalTitle
    }]));

    let processed = rawCharacters.map(char => {
        let sourceVNInfo = null;
        let characterRoleInVN = 'unknown';

        if (char.vns && char.vns.length > 0) {
            const relevantVnsForChar = char.vns
                .filter(cvn => vnMap.has(cvn.id)) // VN must be in user's list
                .map(cvn => ({
                    id: cvn.id,
                    title: vnMap.get(cvn.id)?.title || getTranslation('UnknownWork', '未知作品'),
                    originalTitle: vnMap.get(cvn.id)?.originalTitle,
                    role: cvn.role,
                    spoiler: cvn.spoiler
                }))
                // Filter by spoiler level based on global setting
                .filter(cvn => enableSpoilers || cvn.spoiler === 0);


            // Role matching logic
            sourceVNInfo = relevantVnsForChar.find(cvn => (currentCharacterFilters.role === 'any' || cvn.role === currentCharacterFilters.role || (currentCharacterFilters.role === 'side' && (cvn.role === 'side' || cvn.role === 'appears')))) ||
                relevantVnsForChar.find(cvn => (cvn.role === 'main' || cvn.role === 'primary')) ||
                relevantVnsForChar.find(cvn => (cvn.role === 'side' || cvn.role === 'appears')) ||
                relevantVnsForChar[0]; // Fallback to first if specific role not found

            if (sourceVNInfo) characterRoleInVN = sourceVNInfo.role;
        }

        // Filter traits based on spoiler level
        const visibleTraits = char.traits ? char.traits.filter(t => enableSpoilers || t.spoiler === 0) : [];

        return {
            id: char.id,
            name: char.name,
            originalName: char.original,
            description: char.description,
            sex: char.sex,
            image: char.image,
            traits: visibleTraits, // Use spoiler-filtered traits
            sourceVNInfo: sourceVNInfo || {
                id: null,
                title: getTranslation('UnknownSource', '未知来源'),
                role: 'unknown',
                spoiler: 0 // Default spoiler if no info
            },
            roleInVN: characterRoleInVN
        };
    });

    let filtered = processed.filter(char => {
        const genderMatch = currentCharacterFilters.gender === 'any' || (char.sex && char.sex[0] === currentCharacterFilters.gender);
        // Role match is now implicitly handled by how sourceVNInfo was selected,
        // but we can double-check if a specific role was required and if sourceVNInfo reflects that.
        let roleMatch = currentCharacterFilters.role === 'any';
        if (!roleMatch && char.sourceVNInfo) {
            if (currentCharacterFilters.role === 'main' && char.sourceVNInfo.role === 'main') roleMatch = true;
            else if (currentCharacterFilters.role === 'primary' && char.sourceVNInfo.role === 'primary') roleMatch = true;
            else if (currentCharacterFilters.role === 'side' && (char.sourceVNInfo.role === 'side' || char.sourceVNInfo.role === 'appears')) roleMatch = true;
        } else if (currentCharacterFilters.role !== 'any' && !char.sourceVNInfo.id) { // If role filter active and no valid VN source
            roleMatch = false;
        }
        return genderMatch && roleMatch && char.sourceVNInfo.id; // Ensure there's a valid source VN
    });
    return filtered;
}


// --- API 调用 ---
async function vndbApiCall(endpoint, queryBody) {
    let cacheSubKey = JSON.stringify(queryBody.filters || queryBody.user || queryBody.q || queryBody.id);
    if (queryBody.fields) cacheSubKey += queryBody.fields;
    const usingCache = endpoint !== '/ulist';
    if (usingCache && apiCache.character[cacheSubKey] && apiCache.character[cacheSubKey].expires > Date.now()) {
        return JSON.parse(JSON.stringify(apiCache.character[cacheSubKey].data));
    }
    const response = await fetch(`${VNDB_API_ENDPOINT}${endpoint}`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(queryBody)
    });
    if (!response.ok) {
        const errorText = await response.text();
        console.error(`VNDB API ${endpoint} error. Status: ${response.status}, Query: ${JSON.stringify(queryBody)}, Response: ${errorText}`);
        throw new Error(`VNDB API ${endpoint} error: ${response.status} - ${errorText.substring(0, 100)}`);
    }
    const data = await response.json();
    if (usingCache) apiCache.character[cacheSubKey] = {
        data: JSON.parse(JSON.stringify(data)),
        expires: Date.now() + CACHE_DURATION_CHARACTER_BATCH
    };
    return data;
}

async function fetchUserVNList(userId, labelIds) {
    const allVNsFromAPI = [];
    let currentPage = 1;
    let moreResults = true;
    const labelFilters = labelIds.map(id => ["label", "=", id]);
    const finalFilter = labelFilters.length === 1 ? labelFilters[0] : ["or", ...labelFilters];
    const queryBase = {
        user: userId,
        filters: finalFilter,
        fields: "id, vn{id, title, titles{lang, title, latin, main, official}}", // id is ulist entry id, vn.id is vn id
        results: 50, // VNDB ulist default is 10, max might be 50 or 100
        sort: "vote", // Common sort for user lists
        reverse: true
    };
    while (moreResults) {
        const query = {
            ...queryBase,
            page: currentPage
        };
        const data = await vndbApiCall('/ulist', query);
        if (data.results) {
            const vnsFromPage = data.results
                .filter(item => item.vn && item.id && (item.vn.title || (item.vn.titles && item.vn.titles.length > 0))) // Ensure vn object and its id exist
                .map(item => ({
                    id: item.id, // Use the actual VN ID
                    title: getLocalizedTitle(item.vn.titles, 'zh') || item.vn.title, // Use helper, fallback to main title
                    originalTitle: item.vn.title // Store original main title for reference
                }));
            allVNsFromAPI.push(...vnsFromPage);
        }
        moreResults = data.more || false;
        if (currentPage >= 20 && moreResults) { // Safety break for very long lists
            console.warn("fetchUserVNList: Exceeded 20 pages.");
            backgroundLoadingStatus.textContent = getTranslation('WarnVNListTooLong', '您的 VN 列表过长，已加载部分。');
            break;
        }
        currentPage++;
    }
    return allVNsFromAPI;
}
async function fetchCharactersFromVNsWithCache(vnIds) {
    if (!vnIds || vnIds.length === 0) return [];

    // For character fetching, the cache key should ideally be based on a hash of vnIds if too long,
    // or just join them if the number is small.
    const vnIdsKey = vnIds.length > 10 ? `hash_${vnIds.length}_${vnIds[0]}_${vnIds[vnIds.length - 1]}` : vnIds.slice().sort().join(',');
    const cacheKey = `chars-${vnIdsKey}`;

    if (apiCache.character[cacheKey] && apiCache.character[cacheKey].expires > Date.now()) {
        return JSON.parse(JSON.stringify(apiCache.character[cacheKey].data));
    }

    const fetchedCharactersForBatch = [];
    // Constructing the filter: ((vn = v1) OR (vn = v2) OR ...)
    const vnIdFilters = vnIds.map(vnId => ["id", "=", vnId]); // vn.id from character perspective
    const vnFilterConditions = vnIds.map(vnId => ["vn", "=", ["id", "=", vnId]]);


    let queryFilter;
    if (vnFilterConditions.length === 1) {
        queryFilter = vnFilterConditions[0];
    } else if (vnFilterConditions.length > 1) {
        queryFilter = ["or", ...vnFilterConditions];
    } else {
        return []; // No VN IDs to query for
    }


    const query = {
        filters: queryFilter,
        fields: "id, name, original, description, sex, image.url, traits{id, name, spoiler, group_id, group_name}, vns{id, role, spoiler}", // vn.id here is the VN the char appears in
        results: 100, // Max results per page for characters
        page: 1
    };

    let charCurrentPage = 1;
    let charMoreResults = true;
    while (charMoreResults) {
        query.page = charCurrentPage;
        const data = await vndbApiCall('/character', query);
        if (data.results && data.results.length > 0) {
            fetchedCharactersForBatch.push(...data.results);
        }
        charMoreResults = data.more || false;
        if (charCurrentPage >= 10 && charMoreResults) { // Safety break per batch of VNs
            console.warn("fetchCharactersFromVNs: Exceeded 10 pages for character batch on VNs:", vnIds.slice(0, 3).join(','));
            break;
        }
        charCurrentPage++;
    }

    const uniqueCharacters = Array.from(new Map(fetchedCharactersForBatch.map(char => [char.id, char])).values());

    apiCache.character[cacheKey] = {
        data: JSON.parse(JSON.stringify(uniqueCharacters)),
        expires: Date.now() + CACHE_DURATION_CHARACTER_BATCH
    };
    return uniqueCharacters;
}

function getLocalizedTitle(titlesArray, preferredLangPrefix = 'zh') {
    if (!titlesArray || titlesArray.length === 0) return null;
    const targetLangs = [`${preferredLangPrefix}-hans`, `${preferredLangPrefix}-cn`, preferredLangPrefix, 'zh-hant', 'zh-hk', 'zh-tw'];
    for (const lang of targetLangs) {
        const foundTitle = titlesArray.find(t => t.lang && t.lang.toLowerCase() === lang.toLowerCase() && t.title);
        if (foundTitle) return foundTitle.title;
    }
    const mainNonLatin = titlesArray.find(t => t.main && t.title && !t.latin);
    if (mainNonLatin) return mainNonLatin.title;
    const mainTitle = titlesArray.find(t => t.main && t.title);
    if (mainTitle) return mainTitle.title;
    const officialEnglish = titlesArray.find(t => t.lang && t.lang.toLowerCase() === 'en' && t.official && t.title);
    if (officialEnglish) return officialEnglish.title;
    const anyEnglish = titlesArray.find(t => t.lang && t.lang.toLowerCase() === 'en' && t.title);
    if (anyEnglish) return anyEnglish.title;
    return titlesArray[0].title;
}

function isCJK(text) {
    if (!text) return false;
    return /[\u2E80-\u2EFF\u3000-\u303F\u3040-\u309F\u30A0-\u30FF\u3100-\u312F\u31A0-\u31BF\u31F0-\u31FF\u3200-\u32FF\u3300-\u33FF\u3400-\u4DBF\u4DC0-\u4DFF\u4E00-\u9FFF\uF900-\uFAFF\uFF00-\uFFEF]/.test(text);
}

// --- Character Display and Rating ---
function displayCharacter(character) {
    if (!character) {
        characterDisplayContainer.innerHTML = `<p>${getTranslation('NoMoreCharsOrLoading', '没有更多角色了，或正在加载...')}</p>`;
        if (allChunksLoaded && currentCharacterIndex >= testCharacters.length - 1 && testCharacters.length > 0) {
            finishTest();
        }
        return;
    }
    if (!currentStrategy || !currentStrategy.ratingOptions) {
        characterDisplayContainer.innerHTML = `<p>${getTranslation('ErrorStrategyNotReadyForDisplay', '评分策略未准备好，无法显示角色。')}</p>`;
        return;
    }

    characterDisplayContainer.classList.add('loading-char');
    setTimeout(() => {
        characterDisplayContainer.innerHTML = '';
        const charDisplayName = getTranslation(character.name, (character.originalName && isCJK(character.originalName)) ? character.originalName : character.name);
        const wrapper = document.createElement('div');
        wrapper.className = 'char-content-wrapper';
        const headerDiv = document.createElement('div');
        headerDiv.className = 'char-card-header';
        const imageContainer = document.createElement('div');
        imageContainer.className = 'char-image-container';
        if (character.image && character.image.url) {
            const imgEl = document.createElement('img');
            imgEl.src = character.image.url;
            imgEl.alt = charDisplayName || getTranslation('CharacterImageAlt', '角色图片');
            imgEl.onerror = function () {
                this.alt = getTranslation('ErrorImageLoadFailed', '图片加载失败');
                this.classList.add('placeholder');
                this.parentElement.innerHTML = `<span class="no-image-text">(${getTranslation('ErrorImageLoadFailed', '图片加载失败')})</span>`;
            };
            imageContainer.appendChild(imgEl);
        } else {
            imageContainer.innerHTML = `<span class="no-image-text">(${getTranslation('NoImageAvailable', '无可用图片')})</span>`;
        }
        headerDiv.appendChild(imageContainer);
        const infoDiv = document.createElement('div');
        infoDiv.className = 'char-info';
        const nameEl = document.createElement('h3');
        nameEl.appendChild(createVndbLink(charDisplayName || getTranslation('UnknownName', '未知名称'), character.id, 'character'));
        infoDiv.appendChild(nameEl);
        const metaInfoEl = document.createElement('div');
        metaInfoEl.className = 'char-meta-info';
        let metaTextParts = [];
        if (character.sex && character.sex[0]) {
            const genderMap = {
                'm': getTranslation('GenderMale', '男'),
                'f': getTranslation('GenderFemale', '女'),
                'b': getTranslation('GenderBoth', '双性'),
                'n': getTranslation('GenderNone', '无性别')
            };
            metaTextParts.push(`${getTranslation('GenderLabel', '性别')}: ${genderMap[character.sex[0]] || getTranslation('Unknown', '未知')}`);
        }
        if (character.sourceVNInfo && character.sourceVNInfo.id) {
            const vnDisplayName = getTranslation(character.sourceVNInfo.title, (character.sourceVNInfo.originalTitle && isCJK(character.sourceVNInfo.originalTitle)) ? character.sourceVNInfo.originalTitle : character.sourceVNInfo.title);
            let vnText = `${getTranslation('SourceLabel', '来源')}: `;
            const vnLink = createVndbLink(vnDisplayName || getTranslation('UnknownWork', '未知作品'), character.sourceVNInfo.id, 'vn');
            const tempDiv = document.createElement('div');
            tempDiv.appendChild(document.createTextNode(vnText));
            tempDiv.appendChild(vnLink);
            if (character.sourceVNInfo.role && (enableSpoilers || character.sourceVNInfo.spoiler === 0)) { // Respect spoiler for role
                const roleMap = {
                    'main': getTranslation('RoleMain', '主角'),
                    'primary': getTranslation('RolePrimary', '主要角色'),
                    'side': getTranslation('RoleSide', '次要角色'),
                    'appears': getTranslation('RoleAppears', '登场角色')
                };
                tempDiv.appendChild(document.createTextNode(` (${getTranslation(character.sourceVNInfo.role, roleMap[character.sourceVNInfo.role] || character.sourceVNInfo.role)})`));
            }
            metaTextParts.push(tempDiv.innerHTML);
        }
        metaInfoEl.innerHTML = metaTextParts.map(part => `<span>${part}</span>`).join('');
        infoDiv.appendChild(metaInfoEl);
        headerDiv.appendChild(infoDiv);
        wrapper.appendChild(headerDiv);
        const descriptionContainer = document.createElement('div');
        descriptionContainer.className = 'char-description-container';
        let descText = sanitizeVndbText(character.description, enableSpoilers); // Pass spoiler setting
        descriptionContainer.innerHTML = descText || `${getTranslation('NoDescription', '无简介')}`;
        wrapper.appendChild(descriptionContainer);
        
        const ratingButtonsContainer = document.createElement('div');
        ratingButtonsContainer.className = 'rating-buttons-container';

        // Use rating options from strategy
        const ratingsFromStrategy = currentStrategy.ratingOptions || [{ labelKey: "RatingNeutral", value: 4, defaultLabel: "无感" }];

        ratingsFromStrategy.forEach(r_opt => {
            const button = document.createElement('button');
            button.className = 'rating-button';
            button.textContent = getTranslation(r_opt.labelKey, r_opt.defaultLabel);
            button.onclick = (event) => {
                addRippleEffect(event);
                rateCharacter(character, r_opt.value);
            };
            ratingButtonsContainer.appendChild(button);
        });
        wrapper.appendChild(ratingButtonsContainer);
        characterDisplayContainer.appendChild(wrapper);
        characterDisplayContainer.classList.remove('loading-char');
        backButton.disabled = userRatings.length === 0;
    }, 100);
}

function sanitizeVndbText(text, allowSpoilers = false) {
    if (!text) return '';
    let sanitized = text;
    if (allowSpoilers) {
        sanitized = sanitized.replace(/\[spoiler(?:=[^\]]*)?](.+?)\[\/spoiler\]/gis, '$1'); // Show spoiler content
    } else {
        sanitized = sanitized.replace(/\[spoiler(?:=[^\]]*)?](.+?)\[\/spoiler\]/gis, `<span class="spoiler-text">(${getTranslation('SpoilerHidden', '剧透已隐藏')})</span>`);
    }
    return sanitized
        .replace(/\[url=(https?:\/\/[^\]]+)](.+?)\[\/url\]/gi, '<a href="$1" target="_blank" rel="noopener noreferrer">$2 (外部链接)</a>')
        .replace(/\[url](https?:\/\/[^\]]+)\[\/url\]/gi, '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>')
        .replace(/\[b](.+?)\[\/b]/gi, '<strong>$1</strong>')
        .replace(/\[i](.+?)\[\/i]/gi, '<em>$1</em>')
        .replace(/\[s](.+?)\[\/s]/gi, '<del>$1</del>')
        .replace(/\[color=#?[0-9a-fA-F]{3,6}](.+?)\[\/color]/gi, '$1') // Strip color tags, keep content
        .replace(/\[(?:img|thumb|video|youtube|quote|code|raw|hide|table|tr|th|td|list|event|ruby|rt|rb|noparse|strike|u|sup|sub|center|right|justify|size|font|background|shadow|glow|blur|wave|shake|move|fade|gradient|anidb|wikipedia|renai|erogamescape|getchu|amazonjp|dmm|steam|playstore|appstore|youtube|niconico|bilibili|twitch|twitter|facebook|instagram|discord|patreon|fanbox|website|blog|doujinshi|voice|title|release|prod|staff|char|tag|trait)(?:=[^\]]*)?\]/gi, '') // Remove many common bbcode tags
        .replace(/\[\/(?:img|thumb|video|youtube|quote|code|raw|hide|table|tr|th|td|list|event|ruby|rt|rb|noparse|strike|u|sup|sub|center|right|justify|size|font|background|shadow|glow|blur|wave|shake|move|fade|gradient|anidb|wikipedia|renai|erogamescape|getchu|amazonjp|dmm|steam|playstore|appstore|youtube|niconico|bilibili|twitch|twitter|facebook|instagram|discord|patreon|fanbox|website|blog|doujinshi|voice|title|release|prod|staff|char|tag|trait)\]/gi, '')
        .replace(/\n/g, '<br>');
}

function createVndbLink(text, idWithPrefix, type) {
    const link = document.createElement('a');
    link.textContent = text;
    link.className = 'vndb-link';
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    if (idWithPrefix) {
        let itemActualId = String(idWithPrefix);
        let urlPathSegment = itemActualId; // Default
        let linkPrefix = '';

        // Determine prefix based on type, remove existing prefix from id if present
        const idNumberOnly = itemActualId.replace(/^[cvgtri]+/, '');

        if (type === 'character') linkPrefix = 'c';
        else if (type === 'vn') linkPrefix = 'v';
        else if (type === 'tag' || type === 'traitgroup') linkPrefix = 'g'; // traitgroup uses g, e.g., g31 (Hair Color group)
        else if (type === 'trait') linkPrefix = 't'; // individual traits use t, e.g., t375 (Black Hair)
        else if (itemActualId.startsWith('i')) linkPrefix = 'i'; // Assume image or other 'i' type

        if (linkPrefix) {
            urlPathSegment = linkPrefix + idNumberOnly;
        } else {
            // If no specific type mapping, use original id (might be prefixed already)
            urlPathSegment = itemActualId;
        }
        link.href = `https://vndb.org/${urlPathSegment}`;
    } else {
        link.href = '#';
        link.onclick = (e) => e.preventDefault();
    }
    return link;
}

function rateCharacter(character, ratingValue_1_to_7) {
    if (!currentStrategy) {
        console.error("No strategy loaded, cannot rate character.");
        return;
    }
    const adjustedScore = ratingValue_1_to_7 - 4; // Simple -3 to +3 scale
    const characterName = getTranslation(character.name, (character.originalName && isCJK(character.originalName)) ? character.originalName : character.name);
    const existingEntryIndex = userRatings.findIndex(r => r.character_id === character.id);
    const genderAdjustmentApplied = (currentUserGenderPreference !== 'any' && character.sex && character.sex[0] && character.sex[0] !== currentUserGenderPreference);

    const newEntry = {
        character_id: character.id,
        character_name: characterName,
        character_romanized_name: character.name,
        vn_id: character.sourceVNInfo.id,
        vn_title: character.sourceVNInfo.title,
        rating_1_to_7: ratingValue_1_to_7,
        adjusted_score_neg3_to_pos3: adjustedScore,
        traits_present_at_rating: character.traits.map(t => ({ ...t })), // Store full trait objects
        character_sex: character.sex ? character.sex[0] : 'unknown',
        genderAdjustmentApplied: genderAdjustmentApplied,
        character_obj_snapshot: { // Keep a minimal snapshot for display in results if needed
            id: character.id,
            name: characterName,
            vn_title: character.sourceVNInfo.title,
            vn_id: character.sourceVNInfo.id,
            // No need for genderAdjustmentApplied here as it's on the parent
        },
        skipped: false
    };
    if (existingEntryIndex !== -1 && existingEntryIndex < userRatings.length && userRatings[existingEntryIndex].character_id === testCharacters[currentCharacterIndex].id) {
        userRatings[existingEntryIndex] = newEntry;
    } else {
        userRatings.push(newEntry);
    }
    currentCharacterIndex++;
    if (currentCharacterIndex < testCharacters.length) {
        displayCharacter(testCharacters[currentCharacterIndex]);
    } else {
        if (allChunksLoaded) {
            finishTest();
        } else {
            characterDisplayContainer.innerHTML = `<p>${getTranslation('LoadingMoreChars', '正在加载更多角色...')}</p>`;
        }
    }
    updateCharacterCountDisplay();
}

function handleSkipCharacter() {
    if (currentCharacterIndex >= testCharacters.length) return;
    const character = testCharacters[currentCharacterIndex];
    const characterName = getTranslation(character.name, (character.originalName && isCJK(character.originalName)) ? character.originalName : character.name);
    const existingEntryIndex = userRatings.findIndex(r => r.character_id === character.id);
    const skipEntry = {
        character_id: character.id,
        character_name: characterName,
        character_romanized_name: character.name,
        vn_id: character.sourceVNInfo.id,
        vn_title: character.sourceVNInfo.title,
        rating_1_to_7: null,
        adjusted_score_neg3_to_pos3: null,
        traits_present_at_rating: character.traits.map(t => ({ ...t })),
        character_sex: character.sex ? character.sex[0] : 'unknown',
        genderAdjustmentApplied: false,
        character_obj_snapshot: {
            id: character.id,
            name: characterName,
            vn_title: character.sourceVNInfo.title,
            vn_id: character.sourceVNInfo.id,
        },
        skipped: true
    };
    if (existingEntryIndex !== -1 && existingEntryIndex < userRatings.length && userRatings[existingEntryIndex].character_id === testCharacters[currentCharacterIndex].id) {
        userRatings[existingEntryIndex] = skipEntry;
    } else {
        userRatings.push(skipEntry);
    }
    currentCharacterIndex++;
    if (currentCharacterIndex < testCharacters.length) {
        displayCharacter(testCharacters[currentCharacterIndex]);
    } else {
        if (allChunksLoaded) {
            finishTest();
        } else {
            characterDisplayContainer.innerHTML = `<p>${getTranslation('LoadingMoreChars', '正在加载更多角色...')}</p>`;
        }
    }
    updateCharacterCountDisplay();
}

function displayPreviousCharacter() {
    if (currentCharacterIndex > 0) {
        currentCharacterIndex--;
        displayCharacter(testCharacters[currentCharacterIndex]);
        updateCharacterCountDisplay();
    }
    backButton.disabled = currentCharacterIndex <= 0;
}

function finishTest(premature = false) {
    if (!currentStrategy) {
        showCustomAlert(getTranslation('ErrorStrategyMissingOnFinish', '评分策略丢失，无法生成结果。'), getTranslation('Error', '错误'));
        navigateTo('start');
        return;
    }
    showLoading(true, premature ? 'FinishingTestEarly' : 'TestCompleteAnalysing', premature ? '正在提前结束测试并生成结果...' : '测试完成！正在分析您的喜好特征...');
    backgroundLoadingStatus.textContent = premature ? getTranslation('TestManuallyEnded', '测试已手动结束。') : getTranslation('AllCharsProcessed', '所有角色已处理。');
    setTimeout(() => {
        calculateAndDisplayTraitScores(userRatings.filter(r => !r.skipped));
        navigateTo('results');
        showLoading(false);
    }, 500);
}

// --- Scoring Logic (Modified for Strategy) ---
function calculateAndDisplayTraitScores(currentRatedChars) {
    if (!currentStrategy || !currentStrategy.scoringParameters) {
        traitScoresDisplayContainer.innerHTML = `<p>${getTranslation('ErrorNoStrategyForScores', '未加载评分策略的计分参数，无法分析。')}</p>`;
        resultsSummary.innerHTML = '';
        return;
    }
    if (!currentRatedChars || currentRatedChars.length === 0) {
        traitScoresDisplayContainer.innerHTML = `<p>${getTranslation('NoRatedDataToAnalyze', '没有评分数据可供分析。您可能跳过了所有角色或提前结束了测试。')}</p>`;
        resultsSummary.innerHTML = `<p>${getTranslation('TotalRatedChars', '共评价了 {count} 位角色。', { count: currentRatedChars.length })}</p>`;
        return;
    }
    resultsSummary.innerHTML = `<p>${getTranslation('TotalRatedChars', '共评价了 {count} 位角色。', { count: currentRatedChars.length })}</p>`;

    const traitAggregates = {};
    const traitGroupAggregates = {};
    const scoringParams = currentStrategy.scoringParameters;

    currentRatedChars.forEach(ratedChar => {
        let score = ratedChar.adjusted_score_neg3_to_pos3;
        if (ratedChar.genderAdjustmentApplied) {
            score *= scoringParams.genderAdjustmentFactor;
        }
        const charSnapshot = ratedChar.character_obj_snapshot;

        ratedChar.traits_present_at_rating.forEach(trait => {
            // Check if trait group is enabled by strategy or sexual filter
            const groupSettings = currentStrategy.traitGroupSettings ? currentStrategy.traitGroupSettings[trait.group_id] : null;
            let effectiveGroupEnabled = true;
            if (groupSettings) {
                effectiveGroupEnabled = groupSettings.enabled !== false; // Defaults to true if not specified
                if (filterSexualTraits && groupSettings.isSexualFilterTarget === true) {
                    effectiveGroupEnabled = false;
                }
            } else if (filterSexualTraits && currentStrategy.traitGroupSettings) {
                // Fallback for sexual filter if group not explicitly in strategy but might be a target
                const potentialSexualGroup = Object.values(currentStrategy.traitGroupSettings).find(gs => gs.id === trait.group_id && gs.isSexualFilterTarget);
                if (potentialSexualGroup) effectiveGroupEnabled = false;
            }


            if (!effectiveGroupEnabled) return; // Skip this trait if its group is disabled

            const traitName = getTranslation(trait.name, trait.name);
            const groupName = trait.group_name ? getTranslation(trait.group_name, trait.group_name) : null;

            if (!traitAggregates[trait.id]) {
                traitAggregates[trait.id] = {
                    id: trait.id,
                    name: traitName,
                    group_id: trait.group_id,
                    group_name: groupName,
                    scores: [],
                    count: 0,
                    contributing_chars: []
                };
            }
            traitAggregates[trait.id].scores.push(score);
            traitAggregates[trait.id].count++;
            traitAggregates[trait.id].contributing_chars.push({
                ...charSnapshot,
                score_contribution: score,
                genderAdjustmentApplied: ratedChar.genderAdjustmentApplied
            });

            if (trait.group_id && groupName) { // Ensure group_id and groupName exist
                const groupWeight = groupSettings && groupSettings.weight !== undefined ? groupSettings.weight : 1.0;
                if (!traitGroupAggregates[trait.group_id]) {
                    traitGroupAggregates[trait.group_id] = {
                        id: trait.group_id,
                        name: groupName,
                        scores: [],
                        count: 0,
                        weight: groupWeight,
                        contributing_chars: []
                    };
                }
                traitGroupAggregates[trait.group_id].scores.push(score * groupWeight); // Apply group weight to score for group average
                traitGroupAggregates[trait.group_id].count++;
                // Contributing chars for group could list the trait that contributed
                traitGroupAggregates[trait.group_id].contributing_chars.push({
                    ...charSnapshot,
                    trait_id: trait.id, // Add which trait contributed
                    trait_name: traitName,
                    score_contribution: score * groupWeight,
                    genderAdjustmentApplied: ratedChar.genderAdjustmentApplied
                });
            }
        });
    });

    const allProcessedTraits = {};
    [traitAggregates, traitGroupAggregates].forEach((aggregateSet, index) => {
        const isGroupSet = index === 1;
        Object.values(aggregateSet).forEach(agg => {
            if (agg.scores.length === 0) return;
            const count = agg.scores.length; // or agg.count
            const mean = agg.scores.reduce((a, b) => a + b, 0) / count;
            const variance = count > 0 ? agg.scores.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / count : 0;

            let finalScore = mean;
            let factorsApplied = [];
            let lowSamplePenaltyApplied = false;

            // 1. Low Sample Penalty (Tiered)
            let countFactor = 1.0;
            if (count < scoringParams.minReliableCount) {
                const tiers = scoringParams.lowSamplePenaltyTiers || [];
                let tierApplied = false;
                for (const tier of tiers) {
                    if (count <= tier.maxCount) {
                        countFactor = tier.factor;
                        tierApplied = true;
                        break;
                    }
                }
                if (!tierApplied && scoringParams.lowSamplePenaltyFunction) { // Fallback to function string if tiers don't cover
                    try {
                        const func = new Function('count', 'minReliableCount', `return ${scoringParams.lowSamplePenaltyFunction}`);
                        countFactor = func(count, scoringParams.minReliableCount);
                    } catch (e) { console.error("Error evaluating lowSamplePenaltyFunction", e); }
                }
                finalScore *= countFactor;
                factorsApplied.push(getTranslation('FactorLowSamplePenalty', '样本少惩罚 (x{factor})', { factor: countFactor.toFixed(2) }));
                lowSamplePenaltyApplied = true;
            }

            // 2. Variance Penalty
            const varParams = scoringParams.variancePenalty;
            if (varParams && variance > varParams.threshold) {
                const penaltyRatio = Math.min(1, (variance - varParams.threshold) / (varParams.maxEffectThreshold - varParams.threshold));
                const varianceFactor = (1 - penaltyRatio * (varParams.maxPenaltyRatio || 0.5));
                finalScore *= varianceFactor;
                factorsApplied.push(getTranslation('FactorHighVariancePenalty', '高方差惩罚 (x{factor})', { factor: varianceFactor.toFixed(2) }));
            }

            // 3. Consistency Bonus (Conditional)
            const consParams = scoringParams.consistencyBonus;
            if (consParams && Math.abs(mean) > consParams.meanThreshold && variance < consParams.lowVarianceThreshold) {
                if (!lowSamplePenaltyApplied) { // Only apply if not penalized for low samples
                    finalScore *= consParams.bonusFactor;
                    factorsApplied.push(getTranslation('FactorConsistencyBonus', '高一致性奖励 (x{factor})', { factor: consParams.bonusFactor.toFixed(2) }));
                }
            }
            // Consider group weight for final score of groups
            if (isGroupSet && agg.weight !== undefined && agg.weight !== 1.0) {
                finalScore *= agg.weight;
                factorsApplied.push(getTranslation('FactorGroupWeightApplied', '组权重 (x{factor})', { factor: agg.weight.toFixed(2) }));
            }


            let genderFactorText = '';
            if (currentUserGenderPreference !== 'any') {
                genderFactorText = getTranslation('FactorUserGenderPrefConsidered', '用户性别偏好 ({pref}) 已在评分中考虑', { pref: getTranslation(`GenderPref_${currentUserGenderPreference}`, currentUserGenderPreference) });
                if (agg.contributing_chars.some(c => c.genderAdjustmentApplied === true)) {
                    genderFactorText += ` (${getTranslation('FactorGenderMismatchAdjustedShort', '部分因性别不符调整权重')})`;
                }
                factorsApplied.unshift(genderFactorText);
            }

            allProcessedTraits[agg.id] = {
                id: agg.id,
                name: agg.name,
                isGroup: isGroupSet,
                group_id: !isGroupSet ? agg.group_id : null,
                group_name: !isGroupSet ? agg.group_name : (isGroupSet ? null : getTranslation('None', '无')),
                count: count,
                meanAdjustedScore: mean,
                variance: variance,
                finalScore: finalScore,
                factorsAppliedText: factorsApplied.length > 0 ? factorsApplied.join('; ') : getTranslation('FactorNoneApplied', '无特殊调整'),
                contributing_chars: agg.contributing_chars.sort((a, b) => b.score_contribution - a.score_contribution)
            };
        });
    });
    renderTraitResultsAsTable(allProcessedTraits);
}

function renderTraitResultsAsTable(processedTraitsData) {
    traitScoresDisplayContainer.innerHTML = '';
    if (Object.keys(processedTraitsData).length === 0) {
        traitScoresDisplayContainer.innerHTML = `<p>${getTranslation('NoAnalyzableTraitData', '没有可分析的特征数据。')}</p>`;
        return;
    }
    const table = document.createElement('table');
    const thead = table.createTHead();
    const tbody = table.createTBody();
    const headerRow = thead.insertRow();
    const headers = [getTranslation('TableHeaderTraitGroup', '特征组'), getTranslation('TableHeaderTraitName', '特征名'), getTranslation('TableHeaderFinalScore', '推荐度'), getTranslation('TableHeaderAvgScore', '平均分'), getTranslation('TableHeaderVariance', '方差'), getTranslation('TableHeaderCount', '评分次数'), getTranslation('TableHeaderFactors', '影响因素'), getTranslation('TableHeaderContributors', '主要贡献角色 (前3)')];
    headers.forEach(text => {
        const th = document.createElement('th');
        th.textContent = text;
        headerRow.appendChild(th);
    });

    // 过滤
    const countTreathold = parseInt(countFilterInput.value);
    Object.keys(processedTraitsData).forEach(k => {
        if (processedTraitsData[k].count < countTreathold) delete processedTraitsData[k];
    })

    // 排序
    const sortBy = sortResultsBySelect.value;
    const sortedTraitIds = Object.keys(processedTraitsData).sort((a, b) => {
        const traitA = processedTraitsData[a];
        const traitB = processedTraitsData[b];
        switch (sortBy) {
            case 'meanAdjustedScore':
                return traitB.meanAdjustedScore - traitA.meanAdjustedScore;
            case 'count':
                return traitB.count - traitA.count;
            case 'variance':
                return traitA.variance - traitB.variance; // Lower variance is often better, sort ascending
            case 'name':
                return traitA.name.localeCompare(traitB.name);
            case 'finalScore':
            default:
                return traitB.finalScore - traitA.finalScore;
        }
    });
    const groupsRendered = {};
    sortedTraitIds.forEach(id => {
        const trait = processedTraitsData[id];

        // Render Group Header if it's a group or if it's a trait belonging to an unrendered group
        if (trait.isGroup && !groupsRendered[trait.id]) {
            renderGroupRow(tbody, trait, headers.length);
            groupsRendered[trait.id] = true;
        } else if (!trait.isGroup && trait.group_id && !groupsRendered[trait.group_id]) {
            const groupData = processedTraitsData[trait.group_id] || { // Synthesize group if missing
                id: trait.group_id,
                name: trait.group_name || getTranslation('UnknownGroup', '未知组'),
                isGroup: true, finalScore: 0, meanAdjustedScore: 0, variance: 0, count: 0
            };
            renderGroupRow(tbody, groupData, headers.length);
            groupsRendered[trait.group_id] = true;
        }


        if (!trait.isGroup) { // Render individual trait row
            const row = tbody.insertRow();
            row.className = trait.group_id ? 'sub-trait' : 'individual-trait';
            row.insertCell().textContent = trait.group_name || getTranslation('None', '无');

            const traitNameCell = row.insertCell();
            traitNameCell.className = 'trait-name-cell';
            traitNameCell.appendChild(createVndbLink(trait.name, trait.id, 'trait'));

            row.insertCell().textContent = trait.finalScore.toFixed(2);
            row.insertCell().textContent = trait.meanAdjustedScore.toFixed(3);
            row.insertCell().textContent = trait.variance.toFixed(3);
            row.insertCell().textContent = trait.count;
            row.insertCell().textContent = trait.factorsAppliedText;

            const contribCell = row.insertCell();
            contribCell.className = 'contributing-chars-cell';
            if (trait.contributing_chars && trait.contributing_chars.length > 0) {
                trait.contributing_chars.slice(0, 3).forEach((c, idx) => {
                    const charLink = createVndbLink(c.name, c.id, 'character');
                    contribCell.appendChild(charLink);
                    contribCell.appendChild(document.createTextNode(` (${c.score_contribution.toFixed(2)})`));
                    if (idx < Math.min(trait.contributing_chars.length, 3) - 1) {
                        contribCell.appendChild(document.createElement('br'));
                    }
                });
            } else {
                contribCell.textContent = getTranslation('None', '无');
            }
        }
    });
    traitScoresDisplayContainer.appendChild(table);

    makeTableHeaderSticky(table);
    document.body.scrollTo({
        top: 0
    });
}

function renderGroupRow(tbody, groupData, numHeaders) {
    const groupRow = tbody.insertRow();
    groupRow.className = 'group-row';
    const groupNameCell = groupRow.insertCell();
    groupNameCell.colSpan = numHeaders; // Span all columns

    const groupLink = createVndbLink(groupData.name, groupData.id, 'traitgroup');
    groupNameCell.appendChild(groupLink);

    if (groupData.count > 0) {
        groupNameCell.innerHTML += ` <small>(${getTranslation('GroupOverallRecommend', '组推荐度')}: ${groupData.finalScore.toFixed(2)}, ${getTranslation('AvgScoreLabel', '平均分')}: ${groupData.meanAdjustedScore.toFixed(2)}, ${getTranslation('CountLabel', '次数')}: ${groupData.count})</small>`;
    } else {
        groupNameCell.innerHTML += ` <small>(${getTranslation('GroupNoData', '无数据')})</small>`;
    }
}


// --- Utility Functions ---
function shuffleArray(array) {
    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
}

// --- Save/Load/Export/Import ---
function generateTestStateSnapshot() {
    return {
        userId: currentUserId,
        vnLabels: currentVNLabels,
        characterFilters: currentCharacterFilters,
        userGenderPreference: currentUserGenderPreference,
        samplingRate: currentSamplingRate,
        strategyPath: currentStrategy ? strategySelect.value : null, // Save path to reload strategy
        enableSpoilers: enableSpoilers,
        filterSexualTraits: filterSexualTraits,
        allUserVNs_ids: allUserVNs.map(vn => vn.id), // Keep this for faster reload if API fails
        testCharactersSnapshot: testCharacters.map(char => ({ // Minimal needed to reconstruct display
            id: char.id,
            name: char.name, // Romanized name
            originalName: char.originalName,
            sex: char.sex,
            imageURL: char.image ? char.image.url : null,
            sourceVNInfo: {
                id: char.sourceVNInfo.id,
                title: char.sourceVNInfo.title, // Localized title
                originalTitle: char.sourceVNInfo.originalTitle,
                role: char.sourceVNInfo.role
            },
            traits: char.traits.map(t => ({ id: t.id, name: t.name, group_id: t.group_id, group_name: t.group_name, spoiler: t.spoiler })) // Store full trait objects for scoring
        })),
        userRatings: userRatings.map(r => ({ // Store enough to recalculate scores
            character_id: r.character_id,
            rating_1_to_7: r.rating_1_to_7,
            skipped: r.skipped || false,
            // traits_present_at_rating is already stored in testCharactersSnapshot's traits per character,
            // and userRatings links to character_id.
            genderAdjustmentApplied: r.genderAdjustmentApplied || false // Store this decision
        })),
        currentCharacterIndex: currentCharacterIndex,
        appVersion: APP_VERSION,
        allChunksLoaded: allChunksLoaded
    };
}

function saveProgress() {
    if (currentCharacterIndex < 0 && userRatings.length === 0) {
        showCustomAlert(getTranslation("InfoNoProgressToSave", "测试尚未开始或没有进度可保存。"), getTranslation('Info', '提示'));
        return;
    }
    if (!currentStrategy) {
        showCustomAlert(getTranslation("ErrorNoStrategyOnSave", "评分策略未加载，无法保存进度。"), getTranslation('Error', '错误'));
        return;
    }
    try {
        const stateToSave = generateTestStateSnapshot();
        localStorage.setItem('vndbTraitTestProgress', JSON.stringify(stateToSave));
        showCustomAlert(getTranslation("InfoProgressSaved", "进度已保存！"), getTranslation('Success', '成功'));
    } catch (e) {
        console.error("Error saving progress:", e);
        showCustomAlert(getTranslation('ErrorSaveProgressFailed', '保存进度失败，可能是本地存储已满。'), getTranslation('Error', '错误'));
    }
}

async function loadProgress() {
    const savedStateJSON = localStorage.getItem('vndbTraitTestProgress');
    if (!savedStateJSON) {
        showCustomAlert(getTranslation('ErrorNoSavedProgress', '未找到已保存的进度。'), getTranslation('Info', '提示'));
        return;
    }
    try {
        const savedState = JSON.parse(savedStateJSON);
        let proceedLoad = true;
        // Looser version check: allow loading from any previous 1.x version if major is same.
        const currentMajorVersion = APP_VERSION.split('.')[0];
        const savedMajorVersion = savedState.appVersion ? savedState.appVersion.split('.')[0] : '0';

        if (savedState.appVersion !== APP_VERSION && currentMajorVersion !== savedMajorVersion) {
            await new Promise(resolve => {
                showCustomConfirm(
                    getTranslation('WarnVersionMismatchLoad', '保存的进度来自不同版本的应用 (存档版本: {savedVersion}, 当前版本: {currentVersion})。加载可能出现问题，是否继续？', { savedVersion: savedState.appVersion || '未知', currentVersion: APP_VERSION }),
                    getTranslation('Warning', '警告'),
                    () => { proceedLoad = true; resolve(); },
                    () => { proceedLoad = false; resolve(); }
                );
            });
        }
        if (!proceedLoad) return;

        showLoading(true, 'LoadingProgress', '正在加载进度...');

        if (savedState.strategyPath) {
            currentStrategy = await loadStrategy(savedState.strategyPath);
            if (!currentStrategy) {
                showLoading(false);
                showCustomAlert(getTranslation('ErrorLoadStrategyFromSaveFailed', '无法加载存档中的评分策略 ({path})。请选择一个策略后重试。', { path: savedState.strategyPath }), getTranslation('Error', '错误'));
                localStorage.removeItem('vndbTraitTestProgress'); // Clear potentially problematic save
                resetFullState();
                navigateTo('start');
                return;
            }
            if (strategySelect) strategySelect.value = savedState.strategyPath;
        } else { // Legacy save or error
            currentStrategy = await loadStrategy(availableStrategies[0].path); // Load default
            if (strategySelect) strategySelect.value = availableStrategies[0].path;
            showCustomAlert(getTranslation('WarnStrategyNotFoundLoadDefault', '存档中未指定策略，已加载默认策略。'), getTranslation('Warning', '警告'));
        }


        currentUserId = savedState.userId;
        userIdInput.value = currentUserId;
        currentVNLabels = savedState.vnLabels;
        vndbLabelsContainer.querySelectorAll('input[name="vndbLabel"]').forEach(cb => {
            cb.checked = currentVNLabels.includes(parseInt(cb.value, 10));
        });
        const otherSavedLabels = currentVNLabels.filter(id => ![1, 2, 3, 4, 5, 6].includes(id)); // Assuming these are standard
        vndbLabelsOtherInput.value = otherSavedLabels.join(',');

        currentCharacterFilters = savedState.characterFilters;
        filterGenderSelect.value = currentCharacterFilters.gender || 'any';
        filterRoleSelect.value = currentCharacterFilters.role || 'any';
        currentUserGenderPreference = savedState.userGenderPreference || 'any';
        userGenderPreferenceSelect.value = currentUserGenderPreference;
        currentSamplingRate = savedState.samplingRate;
        samplingPercentageInput.value = currentSamplingRate;

        enableSpoilers = savedState.enableSpoilers || false;
        if (enableSpoilersSelect) enableSpoilersSelect.value = enableSpoilers;
        filterSexualTraits = savedState.filterSexualTraits || false;
        if (filterSexualTraitsSelect) filterSexualTraitsSelect.value = filterSexualTraits;


        if (savedState.allUserVNs_ids && savedState.allUserVNs_ids.length > 0) {
            try { // Attempt to re-fetch to get latest titles, but fall back if needed
                allUserVNs = await fetchUserVNList(currentUserId, currentVNLabels);
            } catch (vnFetchError) {
                console.warn("Failed to re-fetch VN list during progress load. Using IDs for now.", vnFetchError);
                allUserVNs = savedState.allUserVNs_ids.map(id => ({ id: id, title: "VN?", originalTitle: "" }));
            }
        } else {
            allUserVNs = [];
        }

        testCharacters = savedState.testCharactersSnapshot.map(snap => ({
            id: snap.id,
            name: snap.name,
            originalName: snap.originalName,
            sex: snap.sex,
            image: snap.imageURL ? { url: snap.imageURL } : null,
            sourceVNInfo: snap.sourceVNInfo,
            traits: snap.traits.map(t => ({ ...t })), // Ensure traits are proper objects
            description: `(${getTranslation('DescriptionNotRestoredFromSave', '简介未从存档恢复')})` // Desc is not saved to save space
        }));

        addedCharacterIds.clear();
        testCharacters.forEach(tc => addedCharacterIds.add(tc.id));


        userRatings = savedState.userRatings.map(sr => {
            const charInTest = testCharacters.find(tc => tc.id === sr.character_id);
            const characterName = charInTest ? getTranslation(charInTest.name, (charInTest.originalName && isCJK(charInTest.originalName)) ? charInTest.originalName : charInTest.name) : getTranslation('UnknownCharacter', '未知角色');

            return {
                character_id: sr.character_id,
                character_name: characterName,
                character_romanized_name: charInTest ? charInTest.name : "Unknown",
                vn_id: charInTest ? charInTest.sourceVNInfo.id : null,
                vn_title: charInTest ? charInTest.sourceVNInfo.title : getTranslation('UnknownWork', '未知VN'),
                rating_1_to_7: sr.rating_1_to_7,
                adjusted_score_neg3_to_pos3: sr.rating_1_to_7 ? sr.rating_1_to_7 - 4 : null,
                traits_present_at_rating: charInTest ? charInTest.traits.map(t => ({ ...t })) : [],
                character_sex: charInTest ? (charInTest.sex ? charInTest.sex[0] : 'unknown') : 'unknown',
                genderAdjustmentApplied: sr.genderAdjustmentApplied || false,
                character_obj_snapshot: { // Rebuild snapshot
                    id: sr.character_id,
                    name: characterName,
                    vn_title: charInTest ? charInTest.sourceVNInfo.title : getTranslation('UnknownWork', '未知VN'),
                    vn_id: charInTest ? charInTest.sourceVNInfo.id : null,
                },
                skipped: sr.skipped || false
            };
        });

        currentCharacterIndex = savedState.currentCharacterIndex;
        allChunksLoaded = savedState.allChunksLoaded !== undefined ? savedState.allChunksLoaded : true; // If true, no more background loading

        showLoading(false);
        const ratedOrSkippedCount = userRatings.filter(r => r.rating_1_to_7 !== null || r.skipped).length;

        if (currentCharacterIndex >= testCharacters.length && testCharacters.length > 0) { // Test was finished
            backgroundLoadingStatus.textContent = getTranslation('InfoLoadedTestComplete', '已加载已完成的测试进度。');
            finishTest();
        } else if (testCharacters.length > 0 && currentCharacterIndex >= 0 && currentCharacterIndex < testCharacters.length) {
            backgroundLoadingStatus.textContent = getTranslation('InfoProgressLoaded', '进度已加载！');
            navigateTo('test');
            displayCharacter(testCharacters[currentCharacterIndex]);
            updateCharacterCountDisplay();
            backgroundLoadingStatus.textContent += allChunksLoaded ? ` ${getTranslation('AllCharsLoaded', '所有角色已加载。')}` : ` (${getTranslation('WarnBackgroundLoadWontContinueAfterLoad', '之前未完成的后台加载将不会继续。若需加载全部角色，请重新开始测试。')})`;
            if (!allChunksLoaded) { // If saved state implies not all loaded, we mark it as loaded now, no resume of stream
                allChunksLoaded = true;
                updateCharacterCountDisplay();
            }
        } else { // No characters or invalid index
            showCustomAlert(getTranslation('ErrorLoadProgressIncomplete', '加载的进度似乎不完整或无法继续测试。请重新开始。'), getTranslation('Warning', '警告'));
            resetFullState();
            navigateTo('start');
        }

    } catch (e) {
        showLoading(false);
        console.error("Error loading progress:", e);
        showCustomAlert(`${getTranslation('ErrorLoadProgressFailed', '加载进度失败，存档可能已损坏。')} ${e.message}`, getTranslation('Error', '错误'));
        localStorage.removeItem('vndbTraitTestProgress'); // Remove corrupted save
        resetFullState();
        navigateTo('start');
    }
}

function exportReport() {
    if (!currentStrategy) {
        showCustomAlert(getTranslation('ErrorNoStrategyForReport', "评分策略未加载，无法导出报告。"), getTranslation('Error', '错误'));
        return;
    }
    const ratedCharsOnly = userRatings.filter(r => !r.skipped);
    if (ratedCharsOnly.length === 0) {
        showCustomAlert(getTranslation('ErrorNoDataToExport', "没有数据可导出。请先完成测试或至少评价一个角色。"), getTranslation('Info', '提示'));
        return;
    }
    const reportData = {
        userId: currentUserId,
        vnLabels: currentVNLabels,
        characterFilters: currentCharacterFilters,
        userGenderPreference: currentUserGenderPreference,
        samplingRate: currentSamplingRate,
        strategyName: currentStrategy.strategyName,
        strategyPathForReference: strategySelect.value, // Store path for reference
        enableSpoilers: enableSpoilers,
        filterSexualTraits: filterSexualTraits,
        ratedCharactersCount: ratedCharsOnly.length,
        userRatings: ratedCharsOnly.map(r => ({
            char_id: r.character_id,
            char_name: r.character_name, // This should be the localized name used during test
            char_romaji_name: r.character_romanized_name, // Original romanized
            vn_id: r.vn_id,
            vn_title: r.vn_title, // Localized VN title
            rating: r.rating_1_to_7,
            adjusted_score: r.adjusted_score_neg3_to_pos3,
            traits: r.traits_present_at_rating.map(t => ({ // Export full trait objects
                id: t.id,
                name: t.name, // Original trait name
                group_id: t.group_id,
                group_name: t.group_name, // Original group name
                spoiler: t.spoiler // Keep spoiler level
            })),
            char_sex: r.character_sex,
            genderAdjustmentApplied: r.genderAdjustmentApplied || false
        })),
        traitAnalysis: {},
        appVersion: APP_VERSION,
        exportDate: new Date().toISOString()
    };

    const currentTraitData = calculateTraitScoresForExport(ratedCharsOnly); // Use the export version
    reportData.traitAnalysis = currentTraitData; // Store the processed scores directly

    const filename = `vndb_xp_test_report_${currentUserId}_${new Date().toISOString().slice(0, 10)}.json`;
    const blob = new Blob([JSON.stringify(reportData, null, 2)], {
        type: 'application/json'
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    console.log("Report exported.");
    showCustomAlert(getTranslation("SuccessReportExported", "报告已成功导出！"), getTranslation('Success', '成功'));
}

// This function is specifically for getting data for export, might be simpler than display version
function calculateTraitScoresForExport(currentRatedChars) {
    if (!currentStrategy || !currentStrategy.scoringParameters) return {};

    const traitAggregates = {};
    const traitGroupAggregates = {};
    const scoringParams = currentStrategy.scoringParameters;
    // Logic is very similar to calculateAndDisplayTraitScores, but returns data structure for export

    currentRatedChars.forEach(ratedChar => {
        let score = ratedChar.adjusted_score_neg3_to_pos3;
        if (ratedChar.genderAdjustmentApplied) {
            score *= scoringParams.genderAdjustmentFactor;
        }

        ratedChar.traits_present_at_rating.forEach(trait => {
            const groupSettings = currentStrategy.traitGroupSettings ? currentStrategy.traitGroupSettings[trait.group_id] : null;
            let effectiveGroupEnabled = true;
            if (groupSettings) {
                effectiveGroupEnabled = groupSettings.enabled !== false;
                if (filterSexualTraits && groupSettings.isSexualFilterTarget === true) {
                    effectiveGroupEnabled = false;
                }
            } else if (filterSexualTraits && currentStrategy.traitGroupSettings) {
                const potentialSexualGroup = Object.values(currentStrategy.traitGroupSettings).find(gs => gs.id === trait.group_id && gs.isSexualFilterTarget);
                if (potentialSexualGroup) effectiveGroupEnabled = false;
            }
            if (!effectiveGroupEnabled) return;

            const traitName = getTranslation(trait.name, trait.name); // Use translated name for report key
            const groupName = trait.group_name ? getTranslation(trait.group_name, trait.group_name) : null;

            if (!traitAggregates[trait.id]) {
                traitAggregates[trait.id] = { id: trait.id, name: traitName, group_id: trait.group_id, group_name: groupName, scores: [], count: 0 };
            }
            traitAggregates[trait.id].scores.push(score);
            traitAggregates[trait.id].count++;


            if (trait.group_id && groupName) {
                const groupWeight = groupSettings && groupSettings.weight !== undefined ? groupSettings.weight : 1.0;
                if (!traitGroupAggregates[trait.group_id]) {
                    traitGroupAggregates[trait.group_id] = { id: trait.group_id, name: groupName, scores: [], count: 0, weight: groupWeight };
                }
                traitGroupAggregates[trait.group_id].scores.push(score * groupWeight);
                traitGroupAggregates[trait.group_id].count++;
            }
        });
    });

    const exportableTraitScores = {};
    const processAggregatesForExport = (aggregateSet, isGroup) => {
        Object.values(aggregateSet).forEach(agg => {
            if (agg.scores.length === 0) return;
            const count = agg.count;
            const mean = agg.scores.reduce((a, b) => a + b, 0) / count;
            const variance = count > 0 ? agg.scores.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / count : 0;
            let finalScore = mean;
            let lowSamplePenaltyApplied = false;

            let countFactor = 1.0;
            if (count < scoringParams.minReliableCount) {
                const tiers = scoringParams.lowSamplePenaltyTiers || [];
                let tierApplied = false;
                for (const tier of tiers) { if (count <= tier.maxCount) { countFactor = tier.factor; tierApplied = true; break; } }
                if (!tierApplied && scoringParams.lowSamplePenaltyFunction) { /* eval logic */ }
                finalScore *= countFactor;
                lowSamplePenaltyApplied = true;
            }
            const varParams = scoringParams.variancePenalty;
            if (varParams && variance > varParams.threshold) {
                const penaltyRatio = Math.min(1, (variance - varParams.threshold) / (varParams.maxEffectThreshold - varParams.threshold));
                finalScore *= (1 - penaltyRatio * (varParams.maxPenaltyRatio || 0.5));
            }
            const consParams = scoringParams.consistencyBonus;
            if (consParams && Math.abs(mean) > consParams.meanThreshold && variance < consParams.lowVarianceThreshold && !lowSamplePenaltyApplied) {
                finalScore *= consParams.bonusFactor;
            }
            if (isGroup && agg.weight !== undefined && agg.weight !== 1.0) {
                finalScore *= agg.weight;
            }

            const keyName = agg.name + (isGroup ? ` (${getTranslation('TraitGroupSuffix', '特征组')})` : (agg.group_name ? ` (${agg.group_name})` : ""));
            exportableTraitScores[keyName] = {
                id: agg.id, // Store original ID for reference
                isGroup: isGroup,
                group_id: !isGroup ? agg.group_id : null,
                finalScore: finalScore,
                meanAdjustedScore: mean,
                variance: variance,
                count: count,
            };
        });
    };

    processAggregatesForExport(traitAggregates, false);
    processAggregatesForExport(traitGroupAggregates, true);
    return exportableTraitScores;
}


function importReportFromFile(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (event) => { // Make it async to load strategy
        try {
            const reportData = JSON.parse(event.target.result);

            showLoading(true, 'LoadingReport', '正在加载报告...');

            // Attempt to load strategy from report
            if (reportData.strategyPathForReference) {
                currentStrategy = await loadStrategy(reportData.strategyPathForReference);
                if (currentStrategy && strategySelect) {
                    strategySelect.value = reportData.strategyPathForReference;
                } else if (!currentStrategy) {
                    showCustomAlert(getTranslation('WarnStrategyFromReportNotFound', '报告中引用的策略 ({path}) 未找到，将使用默认策略。', { path: reportData.strategyPathForReference }), getTranslation('Warning', '警告'));
                    currentStrategy = await loadStrategy(availableStrategies[0].path); // Fallback to default
                    if (strategySelect) strategySelect.value = availableStrategies[0].path;
                }
            } else { // No strategy in report, load default
                currentStrategy = await loadStrategy(availableStrategies[0].path);
                if (strategySelect) strategySelect.value = availableStrategies[0].path;
                showCustomAlert(getTranslation('WarnNoStrategyInReportLoadDefault', '报告中未指定策略，已加载默认策略。'), getTranslation('Warning', '警告'));
            }
            if (!currentStrategy) {
                showLoading(false);
                showCustomAlert(getTranslation('ErrorNoStrategyCouldBeLoadedForReport', '无法为报告加载任何评分策略。'), getTranslation('Error', '错误'));
                return;
            }


            // Basic info from report
            currentUserId = reportData.userId || "N/A";
            if (userIdInput) userIdInput.value = currentUserId;
            currentVNLabels = reportData.vnLabels || [];
            // ... (restore other UI settings like labels, filters etc. from reportData if needed) ...
            currentCharacterFilters = reportData.characterFilters || { gender: 'any', role: 'any' };
            if (filterGenderSelect) filterGenderSelect.value = currentCharacterFilters.gender;
            if (filterRoleSelect) filterRoleSelect.value = currentCharacterFilters.role;

            currentUserGenderPreference = reportData.userGenderPreference || 'any';
            if (userGenderPreferenceSelect) userGenderPreferenceSelect.value = currentUserGenderPreference;

            currentSamplingRate = reportData.samplingRate || 100;
            if (samplingPercentageInput) samplingPercentageInput.value = currentSamplingRate;

            enableSpoilers = reportData.enableSpoilers || false;
            if (enableSpoilersSelect) enableSpoilersSelect.value = enableSpoilers;
            filterSexualTraits = reportData.filterSexualTraits || false;
            if (filterSexualTraitsSelect) filterSexualTraitsSelect.value = filterSexualTraits;


            // Check if the report contains detailed userRatings with full trait objects
            const canRebuildForScoring = reportData.userRatings && reportData.userRatings.length > 0 &&
                reportData.userRatings[0].traits && Array.isArray(reportData.userRatings[0].traits) &&
                (reportData.userRatings[0].traits.length === 0 || typeof reportData.userRatings[0].traits[0] === 'object');

            if (!canRebuildForScoring) {
                console.warn("Imported report lacks detailed trait objects in userRatings. Displaying summary from traitAnalysis only.");
                resultsSummary.innerHTML = `<p>${getTranslation('ReportImportedUser', '已导入报告，用户')}: ${currentUserId}, ${getTranslation('TotalRatedChars', '共评价了 {count} 位角色。', { count: reportData.ratedCharactersCount || reportData.userRatings.length })}</p>`;
                traitScoresDisplayContainer.innerHTML = '';
                const importedTraitAnalysis = reportData.traitAnalysis;
                if (importedTraitAnalysis && Object.keys(importedTraitAnalysis).length > 0) {
                    // Simplified table rendering from pre-calculated scores
                    const table = document.createElement('table');
                    const thead = table.createTHead();
                    const tbody = table.createTBody();
                    const headerRow = thead.insertRow();
                    const headers = [getTranslation('TableHeaderTraitName', '特征名'), getTranslation('TableHeaderFinalScore', '推荐度'), getTranslation('TableHeaderAvgScore', '平均分'), getTranslation('TableHeaderVariance', '方差'), getTranslation('TableHeaderCount', '次数')];
                    headers.forEach(text => {
                        const th = document.createElement('th');
                        th.textContent = text;
                        headerRow.appendChild(th);
                    });
                    // Sort keys for consistent display
                    const sortedKeys = Object.keys(importedTraitAnalysis).sort((a, b) => {
                        // Attempt to sort by group then name, or just by name
                        const aIsGroup = a.includes(getTranslation('TraitGroupSuffix', '特征组'));
                        const bIsGroup = b.includes(getTranslation('TraitGroupSuffix', '特征组'));
                        if (aIsGroup && !bIsGroup) return -1;
                        if (!aIsGroup && bIsGroup) return 1;
                        return a.localeCompare(b);
                    });

                    for (const traitKey of sortedKeys) {
                        const data = importedTraitAnalysis[traitKey];
                        const row = tbody.insertRow();
                        if (data.isGroup) row.classList.add('group-row-imported');
                        row.insertCell().textContent = traitKey; // Trait name (possibly with group info)
                        row.insertCell().textContent = data.finalScore !== undefined ? data.finalScore.toFixed(2) : 'N/A';
                        row.insertCell().textContent = data.meanAdjustedScore !== undefined ? data.meanAdjustedScore.toFixed(2) : 'N/A';
                        row.insertCell().textContent = data.variance !== undefined ? data.variance.toFixed(2) : 'N/A';
                        row.insertCell().textContent = data.count || 'N/A';
                    }
                    traitScoresDisplayContainer.appendChild(table);
                    traitScoresDisplayContainer.innerHTML += `<p><small>${getTranslation('InfoImportedReportSimplified', '注意: 导入的报告显示的是预处理的摘要信息，部分排序和详细贡献角色可能无法显示。')}</small></p>`;
                } else {
                    showCustomAlert(getTranslation('ErrorNoAnalyzableDataInReport', '导入的报告中没有找到可显示的特征分析数据。'), getTranslation('Warning', '警告'));
                }
                showLoading(false);
                navigateTo('results');
                return;
            }

            // --- If report data is detailed enough, reconstruct userRatings and recalculate ---
            userRatings = reportData.userRatings.map(r => {
                // Traits should be an array of objects from the fixed export
                let reconstructedTraits = r.traits || [];

                const characterName = getTranslation(r.char_name, r.char_romaji_name || getTranslation('UnknownCharacter', '未知角色'));
                const charSnapshot = { // Rebuild snapshot (minimal)
                    id: r.char_id,
                    name: characterName,
                    vn_title: r.vn_title || getTranslation('UnknownWork', '未知VN'),
                    vn_id: r.vn_id || null,
                };

                return {
                    character_id: r.char_id,
                    character_name: characterName,
                    character_romanized_name: r.char_romaji_name || "Unknown",
                    vn_id: r.vn_id,
                    vn_title: r.vn_title,
                    rating_1_to_7: r.rating,
                    adjusted_score_neg3_to_pos3: r.adjusted_score !== undefined ? r.adjusted_score : (r.rating ? r.rating - 4 : null),
                    traits_present_at_rating: reconstructedTraits.map(t => ({ ...t })), // ensure deep copy of trait objects
                    character_sex: r.char_sex || 'unknown',
                    genderAdjustmentApplied: r.genderAdjustmentApplied || false,
                    character_obj_snapshot: charSnapshot,
                    skipped: r.rating === null || r.rating === undefined
                };
            });

            showLoading(false);
            calculateAndDisplayTraitScores(userRatings.filter(r => !r.skipped));
            navigateTo('results');
            backgroundLoadingStatus.textContent = getTranslation('ReportImportedAndProcessed', '报告已导入并使用当前策略重新处理！');
            showCustomAlert(getTranslation("SuccessReportImported", "报告已导入并重新计算！"), getTranslation('Success', '成功'));

        } catch (e) {
            showLoading(false);
            console.error("Error importing report:", e);
            showCustomAlert(`${getTranslation('ErrorImportReportFailed', '导入报告失败')}: ${e.message}`, getTranslation('Error', '错误'));
        }
    };
    reader.readAsText(file);
}

function makeTableHeaderSticky(table) {
    const tableThead = table.querySelector("thead");

    let delta = 0;
    const scrollCallback = (recursion) => {
        const rects = tableThead.getBoundingClientRect();  
        if(rects.top < 0){
            delta -= rects.top;
            tableThead.style.transform = `translateY(${delta}px)`;
        }else {
            tableThead.style.transform = null;
            delta = 0;

            if (recursion) scrollCallback(false);
        }
    };
    document.body.onscroll = () => scrollCallback(true);
    scrollCallback(true);
}