import { clipboard, remote, shell, webFrame } from 'electron';
import fs from 'fs';
import jetpack from 'fs-jetpack';
import path from 'path';
import spellchecker from 'spellchecker';
import i18n from '../i18n/index';
const { app, dialog, getCurrentWebContents, getCurrentWindow, Menu } = remote;


const applySpellCheckSuggestion = (suggestion) => {
	getCurrentWebContents().replaceMisspelling(suggestion);
};

const downloadUrl = (url) => {
	getCurrentWebContents().downloadURL(url);
};

const openLink = (url) => {
	shell.openExternal(url);
};

const copyLinkText = (text) => {
	clipboard.write({ text, bookmark: text });
};

const copyLinkAddress = (url, text) => {
	clipboard.write({ text: url, bookmark: text });
};


const createMenuTemplate = ({
	isEditable,
	selectionText,
	mediaType,
	srcURL,
	linkURL,
	linkText,
	editFlags: {
		canUndo = false,
		canRedo = false,
		canCut = false,
		canCopy = false,
		canPaste = false,
		canSelectAll = false,
	} = {},
	availableDictionaries = [],
	enabledDictionaries = [],
	spellingSuggestions = null,
} = {}, {
	applySpellCheckSuggestion,
	toggleSpellCheckLanguage,
	loadSpellCheckDictionaries,
	downloadUrl,
	openLink,
	copyLinkText,
	copyLinkAddress,
} = {}) => [
	...(Array.isArray(spellingSuggestions) ? [
		...(spellingSuggestions.length === 0 ? (
			[
				{
					label: i18n.__('No_suggestions'),
					enabled: false,
				},
			]
		) : (
			spellingSuggestions.slice(0, 6).map((suggestion) => ({
				label: suggestion,
				click: () => applySpellCheckSuggestion(suggestion),
			}))
		)),
		...(spellingSuggestions.length > 6 ? [
			{
				label: i18n.__('More_spelling_suggestions'),
				submenu: spellingSuggestions.slice(6).map((suggestion) => ({
					label: suggestion,
					click: () => applySpellCheckSuggestion(suggestion),
				})),
			},
		] : []),
		{
			type: 'separator',
		},
	] : []),
	...(isEditable && selectionText === '' ? [
		{
			label: i18n.__('Spelling_languages'),
			enabled: availableDictionaries.length > 0,
			submenu: availableDictionaries.map((language) => ({
				label: language,
				type: 'checkbox',
				checked: enabledDictionaries.includes(language),
				click: ({ checked }) => toggleSpellCheckLanguage(language, checked),
			})),
		},
		{
			label: i18n.__('Browse_for_language'),
			click: () => loadSpellCheckDictionaries(),
		},
		{
			type: 'separator',
		},
	] : []),
	...(mediaType === 'image' ? [
		{
			label: i18n.__('Save image as...'),
			click: () => downloadUrl(srcURL),
		},
		{
			type: 'separator',
		},
	] : []),
	...(linkURL ? [
		{
			label: i18n.__('Open link'),
			click: () => openLink(linkURL),
		},
		{
			label: i18n.__('Copy link text'),
			click: () => copyLinkText(linkText),
			enabled: !!linkText,
		},
		{
			label: i18n.__('Copy link address'),
			click: () => copyLinkAddress(linkURL, linkText),
		},
		{
			type: 'separator',
		},
	] : []),
	{
		label: i18n.__('&Undo'),
		role: 'undo',
		accelerator: 'CommandOrControl+Z',
		enabled: canUndo,
	},
	{
		label: i18n.__('&Redo'),
		role: 'redo',
		accelerator: process.platform === 'win32' ? 'Control+Y' : 'CommandOrControl+Shift+Z',
		enabled: canRedo,
	},
	{
		type: 'separator',
	},
	{
		label: i18n.__('Cu&t'),
		role: 'cut',
		accelerator: 'CommandOrControl+X',
		enabled: canCut,
	},
	{
		label: i18n.__('&Copy'),
		role: 'copy',
		accelerator: 'CommandOrControl+C',
		enabled: canCopy,
	},
	{
		label: i18n.__('&Paste'),
		role: 'paste',
		accelerator: 'CommandOrControl+V',
		enabled: canPaste,
	},
	{
		label: i18n.__('Select &all'),
		role: 'selectall',
		accelerator: 'CommandOrControl+A',
		enabled: canSelectAll,
	},
];


class SpellCheck {
	constructor() {
		this.loadAvailableDictionaries();
		this.setEnabledDictionaries();
	}

	loadAvailableDictionaries() {
		const embeddedDictionaries = spellchecker.getAvailableDictionaries();

		const dictionariesDir = jetpack.cwd(app.getAppPath(), app.getAppPath().endsWith('app.asar') ? '..' : '.',
			'dictionaries');
		const installedDictionaries = dictionariesDir.find({ matching: '*.{aff,dic}' })
			.map((fileName) => path.basename(fileName, path.extname(fileName)).replace('-', '_'));

		this.isMultiLanguage = embeddedDictionaries.length > 0 && process.platform !== 'win32';
		this.dictionariesPath = dictionariesDir.path();
		this.availableDictionaries = this.isMultiLanguage ?
			Array.from(new Set([...embeddedDictionaries, ...installedDictionaries])).sort() :
			Array.from(new Set([...embeddedDictionaries])).sort();
	}

	setEnabledDictionaries() {
		this.enabledDictionaries = [];

		const { dictionaries } = this;
		if (dictionaries) {
			// Dictionary disabled
			if (dictionaries.length === 0) {
				return;
			}
			if (this.setEnabled(dictionaries)) {
				return;
			}
		}

		if (this.userLanguage) {
			if (this.setEnabled(this.userLanguage)) {
				return;
			}
			if (this.userLanguage.includes('_') && this.setEnabled(this.userLanguage.split('_')[0])) {
				return;
			}
		}

		const navigatorLanguage = navigator.language.replace('-', '_');
		if (this.setEnabled(navigatorLanguage)) {
			return;
		}

		if (navigatorLanguage.includes('_') && this.setEnabled(navigatorLanguage.split('_')[0])) {
			return;
		}

		if (this.setEnabled('en_US')) {
			return;
		}

		if (!this.setEnabled('en')) {
			console.info('Unable to set a language for the spell checker - Spell checker is disabled');
		}

	}

	get userLanguage() {
		const language = localStorage.getItem('userLanguage');
		return language ? language.replace('-', '_') : null;
	}

	get dictionaries() {
		const dictionaries = localStorage.getItem('spellcheckerDictionaries');
		const result = JSON.parse(dictionaries || '[]');
		return Array.isArray(result) ? result : [];
	}

	/**
     * Installs all of the dictionaries specified in filePaths
     * Copies dicts into our dictionary path and adds them to availableDictionaries
     */
	installDictionariesFromPaths(dictionaryPaths) {
		for (const dictionaryPath of dictionaryPaths) {
			const dictionaryFileName = dictionaryPath.split(path.sep).pop();
			const dictionaryName = dictionaryFileName.slice(0, -4);
			const newDictionaryPath = path.join(this.dictionariesPath, dictionaryFileName);

			this.copyDictionaryToInstallDirectory(dictionaryName, dictionaryPath, newDictionaryPath);
		}
	}

	copyDictionaryToInstallDirectory(dictionaryName, oldPath, newPath) {
		fs.createReadStream(oldPath).pipe(fs.createWriteStream(newPath)
			.on('error', (errorMessage) => {
				dialog.showErrorBox(i18n.__('Error'), `${ i18n.__('Error copying dictionary file') }: ${ dictionaryName }`);
				console.error(errorMessage);
			})
			.on('finish', () => {
				if (!this.availableDictionaries.includes(dictionaryName)) {
					this.availableDictionaries.push(dictionaryName);
				}
			}));
	}

	setEnabled(dictionaries) {
		dictionaries = [].concat(dictionaries);
		let result = false;
		for (let i = 0; i < dictionaries.length; i++) {
			if (this.availableDictionaries.includes(dictionaries[i])) {
				result = true;
				this.enabledDictionaries.push(dictionaries[i]);
				// If using Hunspell or Windows then only allow 1 language for performance reasons
				if (!this.isMultiLanguage) {
					this.enabledDictionaries = [dictionaries[i]];
					spellchecker.setDictionary(dictionaries[i], this.dictionariesPath);
					return true;
				}
			}
		}
		return result;
	}

	disable(dictionary) {
		const index = this.enabledDictionaries.indexOf(dictionary);
		if (index > -1) {
			this.enabledDictionaries.splice(index, 1);
		}
	}

	enable() {
		webFrame.setSpellCheckProvider('', false, {
			spellCheck: (text) => this.isCorrect(text),
		});

		this.setupContextMenuListener();
	}

	saveEnabledDictionaries() {
		localStorage.setItem('spellcheckerDictionaries', JSON.stringify(this.enabledDictionaries));
	}

	isCorrect(text) {
		if (!this.enabledDictionaries.length) {
			return true;
		}

		for (const language of this.enabledDictionaries) {
			spellchecker.setDictionary(language, this.dictionariesPath);
			if (!spellchecker.isMisspelled(text)) {
				return true;
			}
		}

		return false;
	}

	getCorrections(text) {
		const allCorrections = this.enabledDictionaries.map((language) => {
			spellchecker.setDictionary(language, this.dictionariesPath);
			return spellchecker.getCorrectionsForMisspelling(text);
		}).filter((c) => c.length > 0);

		const length = Math.max(...allCorrections.map((a) => a.length));

		const corrections = [];
		for (let i = 0; i < length; i++) {
			corrections.push(...allCorrections.map((c) => c[i]).filter((c) => c));
		}

		return Array.from(new Set(corrections));
	}

	setupContextMenuListener() {
		getCurrentWebContents().on('context-menu', (event, params) => {
			event.preventDefault();

			const actions = {
				applySpellCheckSuggestion,
				toggleSpellCheckLanguage: (language, checked) => {
					if (!this.isMultiLanguage) {
						this.enabledDictionaries = [];
					}

					if (checked) {
						this.setEnabled(language);
					} else {
						this.disable(language);
					}

					this.saveEnabledDictionaries();
				},
				loadSpellCheckDictionaries: () => {
					dialog.showOpenDialog(
						getCurrentWindow(),
						{
							title: i18n.__('Open_Language_Dictionary'),
							defaultPath: this.dictionariesPath,
							filters: [
								{ name: 'Dictionaries', extensions: ['aff', 'dic'] },
							],
							properties: ['openFile', 'multiSelections'],
						},
						(filePaths) => {
							this.installDictionariesFromPaths(filePaths);
						}
					);
				},
				downloadUrl,
				openLink,
				copyLinkText,
				copyLinkAddress,
			};

			const template = createMenuTemplate({
				...params,
				availableDictionaries: this.availableDictionaries,
				enabledDictionaries: this.enabledDictionaries,
				spellingSuggestions: (({ isEditable, selectionText }) => {
					if (!isEditable || selectionText === '') {
						return null;
					}

					const text = selectionText.toString().trim();

					if (text === '' || this.isCorrect(text)) {
						return null;
					}

					return this.getCorrections(text);
				})(params),
			}, actions);

			const menu = Menu.buildFromTemplate(template);
			menu.popup({ window: getCurrentWindow() });
		}, false);
	}
}


export default SpellCheck;
