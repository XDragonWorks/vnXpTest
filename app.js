const VNDB_API_ENDPOINT = 'https://api.vndb.org/kana';
const APP_VERSION = "1.1.5";

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
// let allFetchedCharacters = []; // 不再需要存储所有原始API角色
let potentialTestCharacters = []; // 用于临时存储过滤后的角色，去重前
let testCharacters = []; // 最终用于测试的角色列表（抽样后、去重后）
let addedCharacterIds = new Set(); // 用于确保加入 testCharacters 的角色全局唯一

let currentCharacterIndex = -1;
let userRatings = [];

let translations = {};
let isLoadingNextChunk = false;
let allChunksLoaded = false;
const CHARS_PER_VN_BATCH_FETCH = 20;
// const MIN_CHARS_TO_START_TEST = 10; // 不再基于此启动，而是首批数据到达即启动
const MIN_RELIABLE_COUNT = 3;

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
const traitScoresDisplayContainer = document.getElementById('trait-scores-display-container');
const exportReportResultsButton = document.getElementById('exportReportButton'); // 在 setupEventListeners 中获取
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
	// 获取模态框元素
	customModalOverlay = document.getElementById('custom-modal-overlay');
	customModal = document.getElementById('custom-modal');
	customModalTitle = document.getElementById('custom-modal-title');
	customModalMessage = document.getElementById('custom-modal-message');
	customModalButtons = document.getElementById('custom-modal-buttons');
	customModalConfirm = document.getElementById('custom-modal-confirm');
	customModalCancel = document.getElementById('custom-modal-cancel');

    // 修改版本号
    document.getElementById('version-footer').innerText = `vnXpTest v${APP_VERSION}`;
    

	await loadTranslations();
	setupEventListeners();
	navigateTo('start', true); // 初始导航
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

function getTranslation(key, fallback = null) {
	return translations[key] || fallback || key;
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
	sortResultsBySelect.addEventListener('change', () => {
		const ratedChars = userRatings.filter(r => !r.skipped);
		if (ratedChars.length > 0) {
			calculateAndDisplayTraitScores(ratedChars);
		}
	});
	// 确保 exportReportButton 存在后再绑定
	const exportBtn = document.getElementById('exportReportButton');
	if (exportBtn) {
		exportBtn.addEventListener('click', exportReport);
	} else {
		// 如果按钮在结果页面，可能需要推迟绑定或确保导航后元素可见
		console.error("Export report button (#exportReportButton) not initially found.");
		// 可以在 navigateTo('results') 成功后尝试重新获取并绑定，但这比较复杂
		// 更好的做法是确保HTML结构在初始加载时就包含所有页面的基本框架
	}
	backToStartButton.addEventListener('click', () => navigateTo('start'));
	document.querySelectorAll('button').forEach(button => {
		button.addEventListener('click', addRippleEffect);
	});

	// 自定义模态框取消按钮
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
		const handleExitAnimationEnd = function() {
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
		resetFullState();
	}
}

function showLoading(isLoading, message = "正在加载...") {
	if (!loadingOverlay || !loadingOverlayMessage) return; // 防御式编程
	loadingOverlayMessage.textContent = message;
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

// --- 自定义模态框函数 ---
let confirmCallback = null;
let alertCallback = null;

function showCustomConfirm(message, title = "确认", onConfirm = () => {}, onCancel = () => {}) {
	if (!customModalOverlay || !customModalTitle || !customModalMessage || !customModalConfirm || !customModalCancel) {
		console.error("Custom modal elements not found!");
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
	if (typeof alertCallback === 'function') {
		customModalConfirm.removeEventListener('click', alertCallback);
	}
	confirmCallback = () => {
		customModalOverlay.classList.remove('active');
		onConfirm();
		confirmCallback = null;
	};
	customModalConfirm.addEventListener('click', confirmCallback, {
		once: true
	});
	customModalOverlay.classList.add('active');
}

function showCustomAlert(message, title = "提示") {
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
	customModalConfirm.addEventListener('click', alertCallback, {
		once: true
	});
	customModalOverlay.classList.add('active');
}

// --- Core Test Logic ---
async function handleStartTest() {
	currentUserId = userIdInput.value.trim();
	if (!currentUserId) {
		showCustomAlert(getTranslation('ErrorUserIDRequired', '请输入 VNDB 用户 ID！'), getTranslation('Error', '错误'));
		return;
	}
	const selectedLabelCheckboxes = Array.from(vndbLabelsContainer.querySelectorAll('input[name="vndbLabel"]:checked')).map(cb => parseInt(cb.value, 10));
	const otherLabelIds = vndbLabelsOtherInput.value.trim() ? vndbLabelsOtherInput.value.split(',').map(id => parseInt(id.trim(), 10)).filter(id => !isNaN(id) && id > 0) : [];
	currentVNLabels = [...new Set([...selectedLabelCheckboxes, ...otherLabelIds])];
	if (currentVNLabels.length === 0) {
		const defaultPlayedCheckbox = vndbLabelsContainer.querySelector('input[value="2"]');
		if (defaultPlayedCheckbox) defaultPlayedCheckbox.checked = true;
		currentVNLabels = [2];
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
	showLoading(true, getTranslation('LoadingVNList', '正在获取您的 VN 列表...'));
	navigateTo('test');
	try {
		allUserVNs = await fetchUserVNListWithCache(currentUserId, currentVNLabels);
		if (!allUserVNs || allUserVNs.length === 0) {
			showCustomAlert(getTranslation('ErrorFetchVNListFailed', '未能获取到该用户的 VN 列表，或列表为空。请检查用户 ID 或标签设置。'), getTranslation('Error', '错误'));
			showLoading(false);
			navigateTo('start');
			return;
		}
		backgroundLoadingStatus.textContent = `${getTranslation('FetchedVNs', '已获取 {count} 部 VN。').replace('{count}', allUserVNs.length)} ${getTranslation('FetchingCharacters', '开始获取角色...')}`;
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
}

function resetFullState() {
	resetTestState();
	userIdInput.value = '';
	vndbLabelsContainer.querySelectorAll('input[name="vndbLabel"]').forEach(cb => cb.checked = (cb.value === '2'));
	vndbLabelsOtherInput.value = '';
	filterGenderSelect.value = 'any';
	filterRoleSelect.value = 'any';
	userGenderPreferenceSelect.value = 'any';
	samplingPercentageInput.value = '100';
}

// --- 流式加载与抽样逻辑修改 ---
async function streamCharacters() {
	let vnIdx = 0;
	const totalVNs = allUserVNs.length;
	testCharacters = []; // 重置最终测试列表
	addedCharacterIds.clear(); // 重置已添加ID
	let testStarted = false;

	async function fetchNextChunk() {
		if (vnIdx >= totalVNs || isLoadingNextChunk || allChunksLoaded) {
			if (vnIdx >= totalVNs && !allChunksLoaded) {
				allChunksLoaded = true;
				backgroundLoadingStatus.textContent = getTranslation('AllCharactersLoaded', '所有角色已加载完毕!');
				if (!testStarted && testCharacters.length === 0) { // 如果加载完所有都没角色
					showLoading(false);
					backgroundLoadingStatus.textContent = getTranslation('NoMatchingCharactersFound', '未找到符合条件的角色。');
					showCustomAlert(getTranslation('ErrorNoCharsAfterFilter', '根据筛选条件，没有找到符合的角色。请尝试更宽松的条件。'), getTranslation('Info', '提示'));
					navigateTo('start');
				} else if (!testStarted && testCharacters.length > 0) {
					// 特殊情况：所有VN加载完，但角色数仍未达到启动阈值，但至少有角色
					// 之前被finalizeAndStartTest()处理，这里确保状态正确
					showLoading(false); // 确保loading隐藏
				}
				// 更新最终计数器
				updateCharacterCountDisplay();
			}
			return;
		}

		isLoadingNextChunk = true;
		const vnBatch = allUserVNs.slice(vnIdx, vnIdx + CHARS_PER_VN_BATCH_FETCH);
		const currentBatchStartIdx = vnIdx;
		vnIdx += CHARS_PER_VN_BATCH_FETCH;

		if (vnBatch.length > 0) {
			const progressMsg = getTranslation('ProcessingVNsProgress', '正在处理 VN {start}-{end} / {total}...').replace('{start}', currentBatchStartIdx + 1).replace('{end}', Math.min(vnIdx, totalVNs)).replace('{total}', totalVNs);
			if (!testStarted) {
				showLoading(true, progressMsg);
			} else {
				backgroundLoadingStatus.textContent = progressMsg;
			}

			try {
				const charactersFromBatch = await fetchCharactersFromVNsWithCache(vnBatch.map(vn => vn.id));
				const newlyFilteredChars = processAndFilterCharacters(charactersFromBatch, allUserVNs);

				// 对新过滤出的角色应用抽样
				let sampledNewChars = [];
				if (currentSamplingRate < 100) {
					shuffleArray(newlyFilteredChars); // 打乱新批次
					const countToSample = Math.ceil(newlyFilteredChars.length * (currentSamplingRate / 100));
					sampledNewChars = newlyFilteredChars.slice(0, countToSample);
				} else {
					sampledNewChars = newlyFilteredChars;
				}

				// 将抽样后且未添加过的角色加入最终测试列表
				let addedInThisBatch = 0;
				sampledNewChars.forEach(char => {
					if (!addedCharacterIds.has(char.id)) {
						testCharacters.push(char);
						addedCharacterIds.add(char.id);
						addedInThisBatch++;
					}
				});

				// 如果是第一批有效角色，则启动测试
				if (!testStarted && testCharacters.length > 0) {
					testStarted = true;
					shuffleArray(testCharacters); // 打乱初始列表
					currentCharacterIndex = 0;
					showLoading(false);
					displayCharacter(testCharacters[currentCharacterIndex]);
					backgroundLoadingStatus.textContent = getTranslation('LoadingRemainingCharsInBackground', '正在后台加载其余角色...');
				}
				// 无论是否启动，都更新计数器
				updateCharacterCountDisplay();

			} catch (e) {
				console.error(`获取 VN 批次角色失败: `, e);
				backgroundLoadingStatus.textContent = getTranslation('ErrorLoadingCharBatch', '批次角色加载失败，仍在继续...');
			}
		}
		isLoadingNextChunk = false;
		requestAnimationFrame(fetchNextChunk);
	}
	await fetchNextChunk();
}


// 只过滤，不抽样和去重
function processAndFilterCharacters(rawCharacters, allVnsMap) {
	const vnMap = new Map(allVnsMap.map(vn => [vn.id, {
		title: vn.title,
		originalTitle: vn.originalTitle
	}]));
	let processed = rawCharacters.map(char => {
		let sourceVNInfo = null;
		let characterRoleInVN = 'unknown';
		if (char.vns && char.vns.length > 0) {
			const relevantVnsForChar = char.vns.filter(cvn => vnMap.has(cvn.id)).map(cvn => ({
				id: cvn.id,
				title: vnMap.get(cvn.id)?.title || getTranslation('UnknownWork', '未知作品'),
				originalTitle: vnMap.get(cvn.id)?.originalTitle,
				role: cvn.role,
				spoiler: cvn.spoiler
			}));
			sourceVNInfo = relevantVnsForChar.find(cvn => cvn.spoiler === 0 && (currentCharacterFilters.role === 'any' || cvn.role === currentCharacterFilters.role || (currentCharacterFilters.role === 'side' && (cvn.role === 'side' || cvn.role === 'appears')))) || relevantVnsForChar.find(cvn => cvn.spoiler === 0 && (cvn.role === 'main' || cvn.role === 'primary')) || relevantVnsForChar.find(cvn => cvn.spoiler === 0 && (cvn.role === 'side' || cvn.role === 'appears')) || relevantVnsForChar.find(cvn => cvn.spoiler === 0) || relevantVnsForChar[0];
			if (sourceVNInfo) characterRoleInVN = sourceVNInfo.role;
		}
		// 返回包含所有需要信息的对象，包括原始trait对象
		return {
			id: char.id,
			name: char.name,
			originalName: char.original,
			description: char.description,
			sex: char.sex,
			image: char.image,
			traits: char.traits ? char.traits.filter(t => t.spoiler === 0) : [],
			sourceVNInfo: sourceVNInfo || {
				id: null,
				title: getTranslation('UnknownSource', '未知来源'),
				role: 'unknown',
				spoiler: 0
			},
			roleInVN: characterRoleInVN
		};
	});
	let filtered = processed.filter(char => {
		const genderMatch = currentCharacterFilters.gender === 'any' || (char.sex && char.sex[0] === currentCharacterFilters.gender);
		let roleMatch = currentCharacterFilters.role === 'any';
		if (!roleMatch && char.sourceVNInfo && char.sourceVNInfo.spoiler === 0) {
			if (currentCharacterFilters.role === 'main' && char.sourceVNInfo.role === 'main') roleMatch = true;
			else if (currentCharacterFilters.role === 'primary' && char.sourceVNInfo.role === 'primary') roleMatch = true;
			else if (currentCharacterFilters.role === 'side' && (char.sourceVNInfo.role === 'side' || char.sourceVNInfo.role === 'appears')) roleMatch = true;
		} else if (currentCharacterFilters.role !== 'any' && (!char.sourceVNInfo || char.sourceVNInfo.spoiler !== 0)) {
			roleMatch = false;
		}
		return genderMatch && roleMatch;
	});
	return filtered; // 返回过滤后的角色数组
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
		throw new Error(`VNDB API ${endpoint} error: ${response.status} - ${errorText.substring(0,100)}`);
	}
	const data = await response.json();
	if (usingCache) apiCache.character[cacheSubKey] = {
		data: JSON.parse(JSON.stringify(data)),
		expires: Date.now() + CACHE_DURATION_CHARACTER_BATCH
	};
	return data;
}
async function fetchUserVNListWithCache(userId, labelIds) {
	const labelsKey = labelIds.sort().join(',');
	const cacheKey = `${userId}-${labelsKey}`;
	if (apiCache.ulist[cacheKey] && apiCache.ulist[cacheKey].expires > Date.now()) {
		return JSON.parse(JSON.stringify(apiCache.ulist[cacheKey].data));
	}
	const allVNsFromAPI = [];
	let currentPage = 1;
	let moreResults = true;
	const labelFilters = labelIds.map(id => ["label", "=", id]);
	const finalFilter = labelFilters.length === 1 ? labelFilters[0] : ["or", ...labelFilters];
	const queryBase = {
		user: userId,
		filters: finalFilter,
		fields: "id, vn{id, title, titles{lang, title, latin, main, official}}",
		results: 50,
		sort: "vote",
		reverse: true
	};
	while (moreResults) {
		const query = {
			...queryBase,
			page: currentPage
		};
		const data = await vndbApiCall('/ulist', query);
        debugger
		if (data.results) {
			const vnsFromPage = data.results.filter(item => item.id && item.vn && (item.vn.title || (item.vn.titles && item.vn.titles.length > 0))).map(item => ({
				id: item.id,
				title: getLocalizedTitle(item.vn.titles, 'zh') || item.vn.title,
				originalTitle: item.vn.title
			}));
			allVNsFromAPI.push(...vnsFromPage);
		}
		moreResults = data.more || false;
		if (currentPage >= 20 && moreResults) {
			console.warn("fetchUserVNList: Exceeded 20 pages.");
			backgroundLoadingStatus.textContent = getTranslation('WarnVNListTooLong', '您的 VN 列表过长，已加载部分。');
			break;
		}
		currentPage++;
	}
	apiCache.ulist[cacheKey] = {
		data: JSON.parse(JSON.stringify(allVNsFromAPI)),
		expires: Date.now() + CACHE_DURATION_ULIST
	};
	return allVNsFromAPI;
}
async function fetchCharactersFromVNsWithCache(vnIds) {
	if (!vnIds || vnIds.length === 0) return [];
	const vnIdsKey = vnIds.slice().sort().join(',');
	const cacheKey = `chars-${vnIdsKey}`;
	if (apiCache.character[cacheKey] && apiCache.character[cacheKey].expires > Date.now()) {
		return JSON.parse(JSON.stringify(apiCache.character[cacheKey].data));
	}
	const fetchedCharactersForBatch = [];
	const vnFilters = vnIds.map(vnId => ["vn", "=", ["id", "=", vnId]]);
	let queryFilter = vnFilters.length === 1 ? vnFilters[0] : ["or", ...vnFilters];
	const query = {
		filters: queryFilter,
		fields: "id, name, original, description, sex, image.url, traits{id, name, spoiler, group_id, group_name}, vns{id, role, spoiler}",
		results: 100,
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
		if (charCurrentPage >= 10 && charMoreResults) {
			console.warn("fetchCharactersFromVNs: Exceeded 10 pages for VNs:", vnIds.slice(0, 3).join(','));
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
			imgEl.onerror = function() {
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
			if (character.sourceVNInfo.role && character.sourceVNInfo.spoiler === 0) {
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
		if (character.description) {
			const descriptionContainer = document.createElement('div');
			descriptionContainer.className = 'char-description-container';
			let descText = sanitizeVndbText(character.description);
			descriptionContainer.innerHTML = descText || `(${getTranslation('NoDescription', '无简介')})`;
			wrapper.appendChild(descriptionContainer);
		}
		const ratingButtonsContainer = document.createElement('div');
		ratingButtonsContainer.className = 'rating-buttons-container';
		const ratings = [{
			label: getTranslation('RatingVeryHate', "非常反感"),
			value: 1
		}, {
			label: getTranslation('RatingHate', "较为反感"),
			value: 2
		}, {
			label: getTranslation('RatingDislike', "略有反感"),
			value: 3
		}, {
			label: getTranslation('RatingNeutral', "无感"),
			value: 4
		}, {
			label: getTranslation('RatingLike', "有点喜欢"),
			value: 5
		}, {
			label: getTranslation('RatingLove', "较为喜欢"),
			value: 6
		}, {
			label: getTranslation('RatingVeryLove', "非常喜欢"),
			value: 7
		}];
		ratings.forEach(r => {
			const button = document.createElement('button');
			button.className = 'rating-button';
			button.textContent = r.label;
			button.onclick = (event) => {
				addRippleEffect(event);
				rateCharacter(character, r.value);
			};
			ratingButtonsContainer.appendChild(button);
		});
		wrapper.appendChild(ratingButtonsContainer);
		characterDisplayContainer.appendChild(wrapper);
		characterDisplayContainer.classList.remove('loading-char');
		backButton.disabled = userRatings.length === 0;
	}, 100);
}

function sanitizeVndbText(text) {
	if (!text) return '';
	return text.replace(/\[url=(https?:\/\/[^\]]+)](.+?)\[\/url\]/gi, '<a href="$1" target="_blank" rel="noopener noreferrer">$2 (外部链接)</a>').replace(/\[url](https?:\/\/[^\]]+)\[\/url\]/gi, '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>').replace(/\[spoiler(?:=[^\]]*)?](.+?)\[\/spoiler\]/gi, `<span class="spoiler-text">(${getTranslation('SpoilerHidden', '剧透已隐藏')})</span>`).replace(/\[b](.+?)\[\/b]/gi, '<strong>$1</strong>').replace(/\[i](.+?)\[\/i]/gi, '<em>$1</em>').replace(/\[s](.+?)\[\/s]/gi, '<del>$1</del>').replace(/\[color=#?[0-9a-fA-F]{3,6}](.+?)\[\/color]/gi, '$1').replace(/\[[a-zA-Z0-9#=\/]+\]/g, '').replace(/\n/g, '<br>');
}
// 修改：使用用户提供的 createVndbLink 版本
function createVndbLink(text, idWithPrefix, type) {
	const link = document.createElement('a');
	link.textContent = text;
	link.className = 'vndb-link';
	link.target = '_blank';
	link.rel = 'noopener noreferrer';
	if (idWithPrefix) {
		let itemActualId = String(idWithPrefix);
		let urlPathSegment = itemActualId;
		if (type === 'character' && !itemActualId.startsWith('c')) urlPathSegment = `c${itemActualId}`;
		else if (type === 'vn' && !itemActualId.startsWith('v')) urlPathSegment = `v${itemActualId}`;
		else if (type === 'tag' && !itemActualId.startsWith('g')) urlPathSegment = `g${itemActualId}`;
		else if (type === 'trait' && itemActualId.startsWith('i')) { // 处理 'i' 前缀
			urlPathSegment = `${itemActualId}`; // 直接使用，例如 i30
		} else if (type === 'trait' && !itemActualId.startsWith('t')) { // 处理无前缀或'tr'前缀
			urlPathSegment = `t${itemActualId.replace(/^tr/, '')}`; // 转换为 t+数字
		} else if (type === 'traitgroup' && !itemActualId.startsWith('g')) urlPathSegment = `g${itemActualId}`; // 组用 g

		// 决定最终 URL path 段
		// 注意：VNDB 链接对于不同类型有不同前缀: /c/, /v/, /g/, /t/ (trait用t), /i/(image用i?)
		// 根据 type 确定前缀
		let linkPrefix = '';
		if (type === 'character') linkPrefix = 'c';
		else if (type === 'vn') linkPrefix = 'v';
		else if (type === 'tag' || type === 'traitgroup') linkPrefix = 'g';
		else if (type === 'trait') linkPrefix = 't'; // 明确 trait 用 't'
		// 特殊处理：如果 id 已经是 i 开头，假设它就是正确的 image ID 或其他 i 类型 ID
		else if (itemActualId.startsWith('i')) linkPrefix = 'i';

		// 去掉 ID 中可能存在的旧前缀，然后加上正确的链接前缀
		const idNumber = itemActualId.replace(/^[cvgtri]+/, '');
		const finalUrlPath = linkPrefix + idNumber;

		link.href = `https://vndb.org/${finalUrlPath}`;
	} else {
		link.href = '#';
		link.onclick = (e) => e.preventDefault();
	}
	return link;
}

function rateCharacter(character, ratingValue_1_to_7) {
	const adjustedScore = ratingValue_1_to_7 - 4;
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
		traits_present_at_rating: character.traits.map(t => ({
			...t
		})),
		character_sex: character.sex ? character.sex[0] : 'unknown',
		genderAdjustmentApplied: genderAdjustmentApplied,
		character_obj_snapshot: {
			id: character.id,
			name: characterName,
			vn_title: character.sourceVNInfo.title,
			vn_id: character.sourceVNInfo.id,
			genderAdjustmentApplied: genderAdjustmentApplied
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
		traits_present_at_rating: character.traits.map(t => ({
			...t
		})),
		character_sex: character.sex ? character.sex[0] : 'unknown',
		genderAdjustmentApplied: false,
		character_obj_snapshot: {
			id: character.id,
			name: characterName,
			vn_title: character.sourceVNInfo.title,
			vn_id: character.sourceVNInfo.id,
			genderAdjustmentApplied: false
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
	showLoading(true, premature ? getTranslation('FinishingTestEarly', '正在提前结束测试并生成结果...') : getTranslation('TestCompleteAnalysing', '测试完成！正在分析您的喜好特征...'));
	backgroundLoadingStatus.textContent = premature ? getTranslation('TestManuallyEnded', '测试已手动结束。') : getTranslation('AllCharsProcessed', '所有角色已处理。');
	setTimeout(() => {
		calculateAndDisplayTraitScores(userRatings.filter(r => !r.skipped));
		navigateTo('results');
		showLoading(false);
	}, 500);
}

// --- Scoring Logic ---
function calculateAndDisplayTraitScores(currentRatedChars) {
	/* (与上次相同) */
	if (!currentRatedChars || currentRatedChars.length === 0) {
		traitScoresDisplayContainer.innerHTML = `<p>${getTranslation('NoRatedDataToAnalyze', '没有评分数据可供分析。您可能跳过了所有角色或提前结束了测试。')}</p>`;
		resultsSummary.innerHTML = `<p>${getTranslation('TotalRatedChars', '共评价了 {count} 位角色。').replace('{count}', currentRatedChars.length)}</p>`;
		return;
	}
	resultsSummary.innerHTML = `<p>${getTranslation('TotalRatedChars', '共评价了 {count} 位角色。').replace('{count}', currentRatedChars.length)}</p>`;
	const traitAggregates = {};
	const traitGroupAggregates = {};
	currentRatedChars.forEach(ratedChar => {
		let score = ratedChar.adjusted_score_neg3_to_pos3;
		if (ratedChar.genderAdjustmentApplied) {
			score *= 0.75;
		}
		const charSnapshot = ratedChar.character_obj_snapshot;
		ratedChar.traits_present_at_rating.forEach(trait => {
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
			if (trait.group_id && groupName) {
				if (!traitGroupAggregates[trait.group_id]) {
					traitGroupAggregates[trait.group_id] = {
						id: trait.group_id,
						name: groupName,
						scores: [],
						count: 0,
						contributing_chars: []
					};
				}
				traitGroupAggregates[trait.group_id].scores.push(score);
				traitGroupAggregates[trait.group_id].count++;
				traitGroupAggregates[trait.group_id].contributing_chars.push({
					...charSnapshot,
					trait_name: traitName,
					score_contribution: score,
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
			const count = agg.scores.length;
			const mean = agg.scores.reduce((a, b) => a + b, 0) / count;
			const variance = count > 0 ? agg.scores.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / count : 0;
			let finalScore = mean;
			let factorsApplied = [];
			let countFactor = 1.0;
			if (count < MIN_RELIABLE_COUNT) {
				countFactor = Math.pow(count / MIN_RELIABLE_COUNT, 0.5);
				finalScore *= countFactor;
				factorsApplied.push(getTranslation('FactorLowSamplePenalty', '样本少惩罚'));
			}
			const varianceThreshold = 0.8;
			const maxVarianceEffect = 1.5;
			let varianceFactor = 1.0;
			if (variance > varianceThreshold) {
				const penaltyRatio = Math.min(1, (variance - varianceThreshold) / (maxVarianceEffect - varianceThreshold));
				varianceFactor = (1 - penaltyRatio * 0.5);
				finalScore *= varianceFactor;
				factorsApplied.push(getTranslation('FactorHighVariancePenalty', '高方差惩罚'));
			}
			const consistencyMeanThreshold = 0.5;
			const lowVarianceForConsistency = 0.5;
			if (Math.abs(mean) > consistencyMeanThreshold && variance < lowVarianceForConsistency) {
				finalScore *= 1.2;
				factorsApplied.push(getTranslation('FactorConsistencyBonus', '高一致性奖励'));
			}
			let genderFactorText = '';
			if (currentUserGenderPreference !== 'any') {
				genderFactorText = getTranslation('FactorUserGenderPrefConsidered', '用户性别偏好 ({pref}) 已在评分中考虑').replace('{pref}', getTranslation(`GenderPref_${currentUserGenderPreference}`, currentUserGenderPreference));
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
				group_name: !isGroupSet ? agg.group_name : null,
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
	/* (与上次相同) */
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
				return traitA.variance - traitB.variance;
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
		if (!trait.isGroup && trait.group_id && !groupsRendered[trait.group_id]) {
			const groupData = processedTraitsData[trait.group_id] || {
				id: trait.group_id,
				name: trait.group_name || getTranslation('UnknownGroup', '未知组'),
				isGroup: true,
				finalScore: 0,
				meanAdjustedScore: 0,
				variance: 0,
				count: 0,
				contributing_chars: []
			};
			const groupRow = tbody.insertRow();
			groupRow.className = 'group-row';
			const groupNameCell = groupRow.insertCell();
			groupNameCell.colSpan = headers.length - 1;
			groupNameCell.appendChild(createVndbLink(groupData.name, groupData.id, 'traitgroup'));
			if (groupData.count > 0) {
				groupNameCell.innerHTML += ` <small>(${getTranslation('GroupOverallRecommend', '组推荐度')}: ${groupData.finalScore.toFixed(2)}, ${getTranslation('AvgScoreLabel', '平均分')}: ${groupData.meanAdjustedScore.toFixed(2)}, ${getTranslation('CountLabel', '次数')}: ${groupData.count})</small>`;
			}
			groupRow.insertCell().textContent = '';
			groupsRendered[trait.group_id] = true;
		} else if (trait.isGroup && !groupsRendered[trait.id]) {
			const groupRow = tbody.insertRow();
			groupRow.className = 'group-row';
			const groupNameCell = groupRow.insertCell();
			groupNameCell.colSpan = headers.length - 1;
			groupNameCell.appendChild(createVndbLink(trait.name, trait.id, 'traitgroup'));
			if (trait.count > 0) {
				groupNameCell.innerHTML += ` <small>(${getTranslation('GroupOverallRecommend', '组推荐度')}: ${trait.finalScore.toFixed(2)}, ${getTranslation('AvgScoreLabel', '平均分')}: ${trait.meanAdjustedScore.toFixed(2)}, ${getTranslation('CountLabel', '次数')}: ${trait.count})</small>`;
			}
			groupRow.insertCell().textContent = '';
			groupsRendered[trait.id] = true;
		}
		if (!trait.isGroup) {
			const row = tbody.insertRow();
			row.className = trait.group_id ? 'sub-trait' : 'individual-trait';
			row.insertCell().textContent = trait.group_name || (trait.isGroup ? '' : getTranslation('None', '无'));
			const traitNameCell = row.insertCell();
			traitNameCell.className = 'trait-name-cell';
			traitNameCell.appendChild(createVndbLink(trait.name, trait.id, trait.isGroup ? 'traitgroup' : 'trait'));
			const finalScoreCell = row.insertCell();
			finalScoreCell.className = 'score-number';
			finalScoreCell.textContent = trait.finalScore.toFixed(2);
			const meanScoreCell = row.insertCell();
			meanScoreCell.className = 'score-number';
			meanScoreCell.textContent = trait.meanAdjustedScore.toFixed(3);
			const varianceCell = row.insertCell();
			varianceCell.className = 'score-number';
			varianceCell.textContent = trait.variance.toFixed(3);
			const countCell = row.insertCell();
			countCell.className = 'score-number';
			countCell.textContent = trait.count;
			const factorsCell = row.insertCell();
			factorsCell.className = 'details-cell';
			factorsCell.textContent = trait.factorsAppliedText;
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
			}
		}
	});
	traitScoresDisplayContainer.appendChild(table);
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
		allUserVNs_ids: allUserVNs.map(vn => vn.id),
		testCharactersSnapshot: testCharacters.map(char => ({
			id: char.id,
			name: char.name,
			originalName: char.originalName,
			sex: char.sex,
			imageURL: char.image ? char.image.url : null,
			sourceVNInfo: {
				id: char.sourceVNInfo.id,
				title: char.sourceVNInfo.title,
				originalTitle: char.sourceVNInfo.originalTitle,
				role: char.sourceVNInfo.role
			},
			traits: char.traits.map(t => ({
				id: t.id,
				name: t.name,
				group_id: t.group_id,
				group_name: t.group_name
			}))
		})),
		userRatings: userRatings.map(r => ({
			character_id: r.character_id,
			rating_1_to_7: r.rating_1_to_7,
			skipped: r.skipped || false,
			genderAdjustmentApplied: r.genderAdjustmentApplied || false
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
	try {
		const stateToSave = generateTestStateSnapshot();
		localStorage.setItem('vndbTraitTestProgress', JSON.stringify(stateToSave));
		console.log("Progress saved.");
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
		if (savedState.appVersion !== APP_VERSION && savedState.appVersion !== "1.1.2" && savedState.appVersion !== "1.1.1" && savedState.appVersion !== "1.1.0" && savedState.appVersion !== "1.0.0") {
			await new Promise(resolve => {
				showCustomConfirm(getTranslation('WarnVersionMismatchLoad', '保存的进度来自不同版本的应用 (存档版本: {savedVersion}, 当前版本: {currentVersion})。加载可能出现问题，是否继续？').replace('{savedVersion}', savedState.appVersion || '未知').replace('{currentVersion}', APP_VERSION), getTranslation('Warning', '警告'), () => {
					proceedLoad = true;
					resolve();
				}, () => {
					proceedLoad = false;
					resolve();
				});
			});
		}
		if (!proceedLoad) return;
		showLoading(true, getTranslation('LoadingProgress', '正在加载进度...'));
		currentUserId = savedState.userId;
		userIdInput.value = currentUserId;
		currentVNLabels = savedState.vnLabels;
		vndbLabelsContainer.querySelectorAll('input[name="vndbLabel"]').forEach(cb => {
			cb.checked = currentVNLabels.includes(parseInt(cb.value, 10));
		});
		const otherSavedLabels = currentVNLabels.filter(id => ![1, 2, 3, 4, 5, 6].includes(id));
		vndbLabelsOtherInput.value = otherSavedLabels.join(',');
		currentCharacterFilters = savedState.characterFilters;
		filterGenderSelect.value = currentCharacterFilters.gender || 'any';
		filterRoleSelect.value = currentCharacterFilters.role || 'any';
		currentUserGenderPreference = savedState.userGenderPreference || 'any';
		userGenderPreferenceSelect.value = currentUserGenderPreference;
		currentSamplingRate = savedState.samplingRate;
		samplingPercentageInput.value = currentSamplingRate;
		if (savedState.allUserVNs_ids && savedState.allUserVNs_ids.length > 0) {
			try {
				allUserVNs = await fetchUserVNListWithCache(currentUserId, currentVNLabels);
			} catch (vnFetchError) {
				console.warn("Failed to re-fetch VN list during progress load.", vnFetchError);
				if (savedState.allUserVNs && savedState.allUserVNs.length > 0 && savedState.allUserVNs[0].hasOwnProperty('title')) {
					allUserVNs = savedState.allUserVNs;
				} else {
					allUserVNs = savedState.allUserVNs_ids.map(id => ({
						id: id,
						title: "VN?",
						originalTitle: ""
					}));
				}
			}
		} else if (savedState.allUserVNs) {
			allUserVNs = savedState.allUserVNs;
		} else {
			allUserVNs = [];
		}
		testCharacters = savedState.testCharactersSnapshot.map(snap => ({
			id: snap.id,
			name: snap.name,
			originalName: snap.originalName,
			sex: snap.sex,
			image: snap.imageURL ? {
				url: snap.imageURL
			} : null,
			sourceVNInfo: snap.sourceVNInfo,
			traits: snap.traits,
			description: `(${getTranslation('DescriptionNotRestoredFromSave', '简介未从存档恢复')})`
		}));
		userRatings = savedState.userRatings.map(sr => {
			const charInTest = testCharacters.find(tc => tc.id === sr.character_id);
			const characterName = charInTest ? getTranslation(charInTest.name, (charInTest.originalName && isCJK(charInTest.originalName)) ? charInTest.originalName : charInTest.name) : getTranslation('UnknownCharacter', '未知角色');
			const charSnapshot = charInTest ? {
				id: charInTest.id,
				name: characterName,
				vn_title: charInTest.sourceVNInfo.title,
				vn_id: charInTest.sourceVNInfo.id,
				genderAdjustmentApplied: sr.genderAdjustmentApplied || false
			} : {
				id: sr.character_id,
				name: getTranslation('UnknownCharacter', '未知角色'),
				vn_title: getTranslation('UnknownWork', '未知VN'),
				vn_id: null,
				genderAdjustmentApplied: sr.genderAdjustmentApplied || false
			};
			return {
				character_id: sr.character_id,
				character_name: characterName,
				character_romanized_name: charInTest ? charInTest.name : "Unknown",
				vn_id: charSnapshot.vn_id,
				vn_title: charSnapshot.vn_title,
				rating_1_to_7: sr.rating_1_to_7,
				adjusted_score_neg3_to_pos3: sr.rating_1_to_7 ? sr.rating_1_to_7 - 4 : null,
				traits_present_at_rating: charInTest ? charInTest.traits.map(t => ({
					...t
				})) : [],
				character_sex: charInTest ? (charInTest.sex ? charInTest.sex[0] : 'unknown') : 'unknown',
				genderAdjustmentApplied: sr.genderAdjustmentApplied || false,
				character_obj_snapshot: charSnapshot,
				skipped: sr.skipped || false
			};
		});
		currentCharacterIndex = savedState.currentCharacterIndex;
		allChunksLoaded = savedState.allChunksLoaded !== undefined ? savedState.allChunksLoaded : true;
		showLoading(false);
		const ratedOrSkippedCount = userRatings.filter(r => r.rating_1_to_7 !== null || r.skipped).length;
		if (currentCharacterIndex >= testCharacters.length - 1 && ratedOrSkippedCount === testCharacters.length && testCharacters.length > 0) {
			backgroundLoadingStatus.textContent = getTranslation('InfoLoadedTestComplete', '已加载已完成的测试进度。');
			finishTest();
		} else if (testCharacters.length > 0 && currentCharacterIndex >= 0 && currentCharacterIndex < testCharacters.length) {
			backgroundLoadingStatus.textContent = getTranslation('InfoProgressLoaded', '进度已加载！');
			navigateTo('test');
			displayCharacter(testCharacters[currentCharacterIndex]);
			updateCharacterCountDisplay();
			backgroundLoadingStatus.textContent += allChunksLoaded ? ` ${getTranslation('AllCharsLoaded', '所有角色已加载。')}` : ` ${getTranslation('PartialCharsLoadedCanContinue', '部分角色已加载，可继续测试。')}`;
			if (!allChunksLoaded) {
				backgroundLoadingStatus.textContent += ` (${getTranslation('WarnBackgroundLoadWontContinue', '未完成的后台加载将不会继续')})`;
				allChunksLoaded = true;
			}
		} else {
			showCustomAlert(getTranslation('ErrorLoadProgressIncomplete', '加载的进度似乎不完整或无法继续测试。请重新开始。'), getTranslation('Warning', '警告'));
			resetFullState();
			navigateTo('start');
		}
	} catch (e) {
		showLoading(false);
		console.error("Error loading progress:", e);
		showCustomAlert(`${getTranslation('ErrorLoadProgressFailed', '加载进度失败，存档可能已损坏。')} ${e.message}`, getTranslation('Error', '错误'));
		localStorage.removeItem('vndbTraitTestProgress');
	}
}

function exportReport() {
	/* (移除成功提示) */
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
		ratedCharactersCount: ratedCharsOnly.length,
		userRatings: ratedCharsOnly.map(r => ({
			char_id: r.character_id,
			char_name: r.character_name,
			char_romaji_name: r.character_romanized_name,
			vn_id: r.vn_id,
			vn_title: r.vn_title,
			rating: r.rating_1_to_7,
			adjusted_score: r.adjusted_score_neg3_to_pos3,
			traits: r.traits_present_at_rating.map(t => getTranslation(t.name, t.name) + (t.group_name ? ` (${getTranslation(t.group_name, t.group_name)})` : '')),
			char_sex: r.character_sex,
			genderAdjustmentApplied: r.genderAdjustmentApplied || false
		})),
		traitAnalysis: {},
		appVersion: APP_VERSION,
		exportDate: new Date().toISOString()
	};
	const traitScoresForExport = {};
	const currentTraitData = calculateTraitScoresForExport(ratedCharsOnly);
	Object.values(currentTraitData).forEach(trait => {
		traitScoresForExport[trait.name + (trait.isGroup ? ` (${getTranslation('TraitGroupSuffix', '特征组')})` : (trait.group_name ? ` (${trait.group_name})` : ""))] = {
			finalScore: trait.finalScore,
			meanAdjustedScore: trait.meanAdjustedScore,
			variance: trait.variance,
			count: trait.count,
		};
	});
	reportData.traitAnalysis = traitScoresForExport;
	const filename = `vndb_xp_test_report_${currentUserId}_${new Date().toISOString().slice(0,10)}.json`;
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
}

function calculateTraitScoresForExport(currentRatedChars) {
	/* (与上次相同) */
	const traitAggregates = {};
	const traitGroupAggregates = {};
	currentRatedChars.forEach(ratedChar => {
		let score = ratedChar.adjusted_score_neg3_to_pos3;
		if (ratedChar.genderAdjustmentApplied) {
			score *= 0.75;
		}
		const charSnapshot = ratedChar.character_obj_snapshot;
		ratedChar.traits_present_at_rating.forEach(trait => {
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
			if (trait.group_id && groupName) {
				if (!traitGroupAggregates[trait.group_id]) {
					traitGroupAggregates[trait.group_id] = {
						id: trait.group_id,
						name: groupName,
						scores: [],
						count: 0,
						contributing_chars: []
					};
				}
				traitGroupAggregates[trait.group_id].scores.push(score);
				traitGroupAggregates[trait.group_id].count++;
				traitGroupAggregates[trait.group_id].contributing_chars.push({
					...charSnapshot,
					trait_name: traitName,
					score_contribution: score,
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
			const count = agg.scores.length;
			const mean = agg.scores.reduce((a, b) => a + b, 0) / count;
			const variance = count > 0 ? agg.scores.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / count : 0;
			let finalScore = mean;
			let countFactor = 1.0;
			if (count < MIN_RELIABLE_COUNT) {
				countFactor = Math.pow(count / MIN_RELIABLE_COUNT, 0.5);
				finalScore *= countFactor;
			}
			const varianceThreshold = 0.8;
			const maxVarianceEffect = 1.5;
			let varianceFactor = 1.0;
			if (variance > varianceThreshold) {
				const penaltyRatio = Math.min(1, (variance - varianceThreshold) / (maxVarianceEffect - varianceThreshold));
				varianceFactor = (1 - penaltyRatio * 0.5);
				finalScore *= varianceFactor;
			}
			const consistencyMeanThreshold = 0.5;
			const lowVarianceForConsistency = 0.5;
			if (Math.abs(mean) > consistencyMeanThreshold && variance < lowVarianceForConsistency) {
				finalScore *= 1.2;
			}
			allProcessedTraits[agg.id] = {
				id: agg.id,
				name: agg.name,
				isGroup: isGroupSet,
				group_id: !isGroupSet ? agg.group_id : null,
				group_name: !isGroupSet ? agg.group_name : null,
				count: count,
				meanAdjustedScore: mean,
				variance: variance,
				finalScore: finalScore,
				contributing_chars: agg.contributing_chars
			};
		});
	});
	return allProcessedTraits;
}

function importReportFromFile(file) { // (修复排序问题，移除成功提示)
	if (!file) return;
	const reader = new FileReader();
	reader.onload = (event) => {
		try {
			const reportData = JSON.parse(event.target.result);
			// 检查报告数据是否包含足够详细的 userRatings 以重建
			const canRebuild = reportData.userRatings && reportData.userRatings.length > 0 && reportData.userRatings[0].hasOwnProperty('traits'); // 需要导出时包含 traits 对象

			if (!canRebuild) {
				console.warn("Imported report lacks detailed user rating data including traits. Displaying summary only.");
				currentUserId = reportData.userId || "N/A";
				currentVNLabels = reportData.vnLabels || [];
				currentCharacterFilters = reportData.characterFilters || {
					gender: 'any',
					role: 'any'
				};
				currentUserGenderPreference = reportData.userGenderPreference || 'any';
				currentSamplingRate = reportData.samplingRate || 100;
				resultsSummary.innerHTML = `<p>${getTranslation('ReportImportedUser', '已导入报告，用户')}: ${currentUserId}, ${getTranslation('TotalRatedChars', '共评价了 {count} 位角色。').replace('{count}', reportData.ratedCharactersCount || reportData.userRatings.length)}</p>`;
				traitScoresDisplayContainer.innerHTML = '';
				const importedTraitAnalysis = reportData.traitAnalysis;
				if (importedTraitAnalysis && Object.keys(importedTraitAnalysis).length > 0) {
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
					for (const traitKey in importedTraitAnalysis) {
						const data = importedTraitAnalysis[traitKey];
						const row = tbody.insertRow();
						row.insertCell().textContent = traitKey;
						row.insertCell().textContent = data.finalScore !== undefined ? data.finalScore.toFixed(2) : 'N/A';
						row.insertCell().textContent = data.meanAdjustedScore !== undefined ? data.meanAdjustedScore.toFixed(2) : 'N/A';
						row.insertCell().textContent = data.variance !== undefined ? data.variance.toFixed(2) : 'N/A';
						row.insertCell().textContent = data.count || 'N/A';
					}
					traitScoresDisplayContainer.appendChild(table);
					traitScoresDisplayContainer.innerHTML += `<p><small>${getTranslation('InfoImportedReportSimplified', '注意: 导入的报告显示的是摘要信息。')}</small></p>`;
					navigateTo('results');
				} else {
					showCustomAlert(getTranslation('ErrorNoAnalyzableDataInReport', '导入的报告中没有找到可显示的特征分析数据。'), getTranslation('Warning', '警告'));
				}
				return;
			}

			// --- 如果报告数据足够，则重建并计算 ---
			currentUserId = reportData.userId || "N/A";
			currentVNLabels = reportData.vnLabels || [];
			currentCharacterFilters = reportData.characterFilters || {
				gender: 'any',
				role: 'any'
			};
			currentUserGenderPreference = reportData.userGenderPreference || 'any';
			currentSamplingRate = reportData.samplingRate || 100;

			const reconstructedRatings = reportData.userRatings.map(r => {
				// 假设导出的 traits 是对象数组（如果不是，这里会出错）
				let reconstructedTraits = Array.isArray(r.traits) ? r.traits : [];

				const characterName = getTranslation(r.char_name, r.char_romaji_name || getTranslation('UnknownCharacter', '未知角色'));
				const charSnapshot = {
					id: r.char_id,
					name: characterName,
					vn_title: r.vn_title,
					vn_id: r.vn_id,
					genderAdjustmentApplied: r.genderAdjustmentApplied || false
				};

				return {
					character_id: r.char_id,
					character_name: characterName,
					character_romanized_name: r.char_romaji_name || "Unknown",
					vn_id: r.vn_id,
					vn_title: r.vn_title,
					rating_1_to_7: r.rating,
					adjusted_score_neg3_to_pos3: r.adjusted_score !== undefined ? r.adjusted_score : (r.rating ? r.rating - 4 : null),
					traits_present_at_rating: reconstructedTraits,
					character_sex: r.char_sex || 'unknown',
					genderAdjustmentApplied: r.genderAdjustmentApplied || false,
					character_obj_snapshot: charSnapshot,
					skipped: r.rating === null || r.rating === undefined
				};
			});

			userRatings = reconstructedRatings; // 更新全局状态
			calculateAndDisplayTraitScores(userRatings.filter(r => !r.skipped)); // 计算并渲染可排序表格
			navigateTo('results');
			// 移除成功提示 console.log('Report imported and processed.');
			backgroundLoadingStatus.textContent = getTranslation('ReportImportedAndProcessed', '报告已导入并处理！'); // 显示状态

		} catch (e) {
			console.error("Error importing report:", e);
			showCustomAlert(`${getTranslation('ErrorImportReportFailed', '导入报告失败')}: ${e.message}`, getTranslation('Error', '错误'));
		}
	};
	reader.readAsText(file);
}