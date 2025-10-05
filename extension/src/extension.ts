'use strict';
// 'vscode' 模块包含了 VS Code 的扩展性 API
// 在下面的代码中导入该模块并使用别名 vscode 引用它
import * as vscode from 'vscode';
import * as path from 'path';
import LineCounter from './LineCounter';
import Gitignore from './Gitignore';
import * as JSONC from 'jsonc-parser';
import * as minimatch from 'minimatch';
import { TextDecoder, TextEncoder } from 'util';
// import { debug } from 'console';

const EXTENSION_ID = 'uctakeoff.vscode-counter';
const EXTENSION_NAME = 'VSCodeCounter';
const CONFIGURATION_SECTION = 'VSCodeCounter';
const toZeroPadString = (num: number, fig: number) => num.toString().padStart(fig, '0');
const dateToString = (date: Date) => `${date.getFullYear()}-${toZeroPadString(date.getMonth()+1, 2)}-${toZeroPadString(date.getDate(), 2)}`
                + ` ${toZeroPadString(date.getHours(), 2)}:${toZeroPadString(date.getMinutes(), 2)}:${toZeroPadString(date.getSeconds(), 2)}`;
const toStringWithCommas = (obj: any) => {
    if (typeof obj === 'number') {
        return new Intl.NumberFormat('en-US').format(obj);
    } else {
        return obj.toString();
    }
};
const log = (message: string, ...items:any[]) => console.log(`[${EXTENSION_NAME}] ${new Date().toISOString()} ${message}`, ...items);
const showError = (message: string, ...items:any[]) => vscode.window.showErrorMessage(`[${EXTENSION_NAME}] ${message}`, ...items);

// 当您的扩展被激活时，此方法被调用
// 首次执行命令时激活您的扩展
export function activate(context: vscode.ExtensionContext) {
    const version = vscode.extensions.getExtension(EXTENSION_ID)?.packageJSON?.version;
    log(`${EXTENSION_ID} ver.${version} 现在已激活！: ${context.extensionPath}`);
    const codeCountController = new CodeCounterController();
    context.subscriptions.push(
        codeCountController,
        vscode.commands.registerCommand('extension.vscode-counter.countInWorkspace', () => codeCountController.countInWorkspace()),
        vscode.commands.registerCommand('extension.vscode-counter.countInDirectory', (targetDir: vscode.Uri|undefined) => codeCountController.countInDirectory(targetDir)),
        vscode.commands.registerCommand('extension.vscode-counter.countInFile', () => codeCountController.toggleVisible()),
        vscode.commands.registerCommand('extension.vscode-counter.saveLanguageConfigurations', () => codeCountController.saveLanguageConfigurations()),
        vscode.commands.registerCommand('extension.vscode-counter.outputAvailableLanguages', () => codeCountController.outputAvailableLanguages())
    );
}
// 当您的扩展被停用时，此方法被调用
export function deactivate() {
}

async function currentWorkspaceFolder() {
    const folders = vscode.workspace.workspaceFolders ?? [];
    if (folders.length <= 0) {
        return undefined;
    } else if (folders.length === 1) {
        return folders[0];
    } else {
        return await vscode.window.showWorkspaceFolderPick();
    }
}

class CodeCounterController {
    private codeCounter_: LineCounterTable|null = null;
    private statusBarItem: vscode.StatusBarItem|null = null;
    private outputChannel: vscode.OutputChannel|null = null;
    private disposable: vscode.Disposable;

    constructor() {
        // 订阅选择更改和编辑器激活事件
        let subscriptions: vscode.Disposable[] = [];
        vscode.window.onDidChangeActiveTextEditor(this.onDidChangeActiveTextEditor, this, subscriptions);
        vscode.workspace.onDidChangeConfiguration(this.onDidChangeConfiguration, this, subscriptions);
        vscode.workspace.onDidChangeTextDocument(this.onDidChangeTextDocument, this, subscriptions);
        vscode.workspace.onDidChangeWorkspaceFolders(this.onDidChangeWorkspaceFolders, this, subscriptions);
        // 从两个事件订阅创建一个组合的 disposable
        this.disposable = vscode.Disposable.from(...subscriptions);
    }
    dispose() {
        this.statusBarItem?.dispose();
        this.statusBarItem = null;
        this.outputChannel?.dispose();
        this.outputChannel = null;
        this.disposable.dispose();
        this.codeCounter_ = null;
    }
    private async getCodeCounter() {
        if (this.codeCounter_) {
            return this.codeCounter_
        }
        const langs = await loadLanguageConfigurations();        
        log(`加载语言设置 = ${langs.size}`);
        await collectLanguageConfigurations(langs);
        log(`收集语言设置 = ${langs.size}`);
        const filesConf = vscode.workspace.getConfiguration("files", null);
        this.codeCounter_ = new LineCounterTable(langs, Object.entries(filesConf.get<{[key:string]:string}>('associations', {})));
        //this.saveLanguageConfigurations(langs);
        return this.codeCounter_;
    }
    public saveLanguageConfigurations() {
        this.getCodeCounter()
        .then(c => saveLanguageConfigurations(c.entries()))
        .catch(reason => showError(`saveLanguageConfigurations() 失败。`, reason));
    }

    public outputAvailableLanguages() {
        this.getCodeCounter().then(c => {
            c.entries().forEach((lang, id) => {
                this.toOutputChannel(`${id} : 别名[${lang.aliases}], 扩展名[${lang.extensions}], 文件名:[${lang.filenames}]`);
            });
            this.toOutputChannel(`VS Code 计数器 : 可用的所有 ${c.entries().size} 种语言。`);
        })
        .catch(reason => showError(`outputAvailableLanguages() 失败。`, reason));
    }

    public async countInDirectory(targetDir: vscode.Uri|undefined) {
        try {
            const folder = await currentWorkspaceFolder();
            if (!folder) {
                showError(`没有打开的工作区`);
            } else if (targetDir) {
                this.countLinesInDirectory(targetDir, folder.uri);
            } else {
                const option = {
                    value : folder.uri.toString(true),
                    placeHolder: "输入目录路径",
                    prompt: "输入目录路径。"
                };
                const uri = await vscode.window.showInputBox(option);
                if (uri) {
                    this.countLinesInDirectory(vscode.Uri.parse(uri), folder.uri);
                }
            }
        } catch (e) {
            showError(`countInDirectory() 失败。`, e.message);
        }
    }
    public async countInWorkspace() {
        try {
            const folder = await currentWorkspaceFolder();
            if (folder) {
                this.countLinesInDirectory(folder.uri, folder.uri);
            } else {
                showError(`没有打开的文件夹。`);
            }
        } catch (e) {
            showError(`countInWorkspace() 失败。`, e.message);
        }
    }
    private countLinesInDirectory(targetUri: vscode.Uri, workspaceDir: vscode.Uri) {
        const conf = vscode.workspace.getConfiguration(CONFIGURATION_SECTION);
        const outputDir = buildUri(workspaceDir, conf.get('outputDirectory', '.VSCodeCounter'));
        this.getCodeCounter()
        .then(c => countLinesInDirectory(c, targetUri, outputDir, conf, this.toOutputChannel))
        .then(results => outputResults(targetUri, results, outputDir, conf))
        .catch(reason => showError(`countLinesInDirectory() 失败。`, reason));
   }

    private onDidChangeWorkspaceFolders(e: vscode.WorkspaceFoldersChangeEvent) {
        log(`onDidChangeWorkspaceFolders()`);
        // e.added.forEach((f) =>   log(` 添加   [${f.index}] ${f.name} : ${f.uri}`));
        // e.removed.forEach((f) => log(` 移除 [${f.index}] ${f.name} : ${f.uri}`));
        // vscode.workspace.workspaceFolders?.forEach((f) => log(` [${f.index}] ${f.name} : ${f.uri}`));
    }
    private onDidChangeActiveTextEditor(e: vscode.TextEditor|undefined) {
        if (this.codeCounter_) {
            log(`onDidChangeActiveTextEditor(${!e ? '未定义' : e.document.uri})`);
            this.countFile(e?.document);
        }
    }
    private onDidChangeTextDocument(e: vscode.TextDocumentChangeEvent) {
        if (this.codeCounter_) {
            log(`onDidChangeTextDocument(${e.document.uri})`);
            this.countFile(e.document);
        }
    }
    private onDidChangeConfiguration() {
        log(`onDidChangeConfiguration()`);
        this.codeCounter_ = null;
        this.countFile(vscode.window.activeTextEditor?.document);
    }

    public toggleVisible() {
        if (!this.statusBarItem) {
            this.statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left);
            this.countFile(vscode.window.activeTextEditor?.document);
        } else {
            this.statusBarItem.dispose();
            this.statusBarItem = null;
        }
    }
    private showStatusBar(text: string) {
        if (this.statusBarItem) {
            this.statusBarItem.show();
            this.statusBarItem.text = text;
        }
    }
    private countFile(doc: vscode.TextDocument|undefined) {
        if (!doc) {
            this.showStatusBar(`${EXTENSION_NAME}:不支持`);
        } else {
            this.getCodeCounter().then(c =>{
                const lineCounter = c.getById(doc.languageId) || c.getByUri(doc.uri);
                if (lineCounter) {
                    const result = lineCounter?.count(doc.getText());
                    this.showStatusBar(`代码:${result.code} 注释:${result.comment} 空白:${result.blank}`);
                } else {
                    this.showStatusBar(`${EXTENSION_NAME}:不支持`);
                }
            });
        }
    }
    private toOutputChannel(text: string) {
        if (!this.outputChannel) {
            this.outputChannel = vscode.window.createOutputChannel(EXTENSION_NAME);
        }
        this.outputChannel.show();
        this.outputChannel.appendLine(text);
    }

}
const encodingTable = new Map<string, string>([
    ['big5hkscs',    'big5-hkscs'],
    // ['cp437',        ''],
    // ['cp850',        ''],
    // ['cp852',        ''],
    // ['cp865',        ''],
    // ['cp866',        ''],
    // ['cp950',        ''],
    ['eucjp',        'euc-jp'],
    ['euckr',        'euc-kr'],
    // ['gb18030',      ''],
    // ['gb2312',       ''],
    // ['gbk',          ''],
    // ['iso88591',     ''],
    // ['iso885910',    ''],
    // ['iso885911',    ''],
    // ['iso885913',    ''],
    // ['iso885914',    ''],
    // ['iso885915',    ''],
    // ['iso88592',     ''],
    // ['iso88593',     ''],
    // ['iso88594',     ''],
    // ['iso88595',     ''],
    // ['iso88596',     ''],
    // ['iso88597',     ''],
    // ['iso88598',     ''],
    // ['iso88599',     ''],
    ['iso885916',    'iso-8859-16'],
    ['koi8r',        'koi8-r'],
    ['koi8ru',       'koi8-ru'],
    ['koi8t',        'koi8-t'],
    ['koi8u',        'koi8-u'],
    ['macroman',     'x-mac-roman'],
    ['shiftjis',     'shift-jis'],
    ['utf16be',      'utf-16be'],
    ['utf16le',      'utf-16le'],
    // ['utf8',         ''],
    ['utf8bom',      'utf8'],
    ['windows1250',  'windows-1250'],
    ['windows1251',  'windows-1251'],
    ['windows1252',  'windows-1252'],
    ['windows1253',  'windows-1253'],
    ['windows1254',  'windows-1254'],
    ['windows1255',  'windows-1255'],
    ['windows1256',  'windows-1256'],
    ['windows1257',  'windows-1257'],
    ['windows1258',  'windows-1258'],
    ['windows874',   'windows-874'],
]);

const buildUri = (uri: vscode.Uri, filename: string) => uri.with({path: `${uri.path}/${filename}`});
const dirUri = (uri: vscode.Uri) => uri.with({path: path.dirname(uri.path)});

function readFileAll(fileUris: vscode.Uri[]) : Promise<{uri:vscode.Uri, data:Uint8Array|null, error?:any}[]> {
    const ret: {uri:vscode.Uri, data:Uint8Array|null, error?:any}[] = [];
    return new Promise((resolve: (values: {uri:vscode.Uri, data:Uint8Array|null, error?:any}[])=> void, reject: (reason: any) => void) => {
        if (fileUris.length > 0) {
            fileUris.forEach(fileUri => {
                vscode.workspace.fs.readFile(fileUri).then(data => {
                    log(`读取文件 : ${fileUri} : ${data.length}B`);
                    ret.push({uri:fileUri, data: data});
                    if (ret.length === fileUris.length) {
                        resolve(ret);
                    }
                },
                (reason:any) => {
                    log(`读取文件 : ${fileUri} : 错误 ${reason}`);
                    ret.push({uri:fileUri, data: null, error: reason});
                    if (ret.length === fileUris.length) {
                        resolve(ret);
                    }
                });
            });
        } else {
            resolve(ret);
        }
    });
}
function countLinesInDirectory(lineCounterTable: LineCounterTable, targetUri: vscode.Uri, outputDir: vscode.Uri, configuration: vscode.WorkspaceConfiguration, consoleOut:(text:string)=>void) {
    log(`统计目录行数 : ${targetUri}, 输出目录: ${outputDir.fsPath}`);
    const confFiles = vscode.workspace.getConfiguration("files", null);
    const includes = configuration.get<string[]>('include', ['**/*']);
    const excludes = configuration.get<string[]>('exclude', []);
    if (configuration.get('useFilesExclude', true)) {
        excludes.push(...Object.keys(confFiles.get<object>('exclude', {})));
    }
    const encoding = confFiles.get('encoding', 'utf8');
    const decoder = new TextDecoder(encodingTable.get(encoding) || encoding);
    const decoderU8 = new TextDecoder('utf8');

    excludes.push(vscode.workspace.asRelativePath(outputDir));
    log(`包含 : "${includes.join('", "')}"`);
    log(`排除 : "${excludes.join('", "')}"`);

    return new Promise((resolve: (p: vscode.Uri[])=> void, reject: (reason: any) => void) => {
        vscode.workspace.findFiles(`{${includes.join(',')}}`, `{${excludes.join(',')}}`).then((files: vscode.Uri[]) => {
            const fileUris = files.filter(uri => uri.path.startsWith(targetUri.path));
            if (configuration.get('useGitignore', true)) {
                log(`目标 : ${fileUris.length} 个文件 -> 使用 .gitignore`);
                vscode.workspace.findFiles('**/.gitignore', '').then((gitignoreFiles: vscode.Uri[]) => {
                    gitignoreFiles.forEach(f => log(`使用 gitignore : ${f}`));
                    readFileAll(gitignoreFiles.sort()).then((values) => {
                        const gitignores = new Gitignore('').merge(...values.map(p => new Gitignore(decoderU8.decode(p.data), dirUri(p.uri).fsPath)));
                        resolve(fileUris.filter(p => gitignores.excludes(p.fsPath)));
                    },
                    reject
                    );
                },
                reject
                );
            } else {
                resolve(fileUris);
            }
        });
    }).then((fileUris: vscode.Uri[]) => {
        log(`目标 : ${fileUris.length} 个文件`);
        return new Promise((resolve: (value: Result[])=> void, reject: (reason: string) => void) => {
            const results: Result[] = [];
            if (fileUris.length <= 0) {
                resolve(results);
            }
            const ignoreUnsupportedFile = configuration.get('ignoreUnsupportedFile', true);
            let fileCount = 0;
            fileUris.forEach(fileUri => {
                const lineCounter = lineCounterTable.getByUri(fileUri);
                if (lineCounter) {
                    vscode.workspace.fs.readFile(fileUri).then(data => {
                        ++fileCount;
                        try {
                            results.push(new Result(fileUri, lineCounter.name, lineCounter.count(decoder.decode(data))));
                        } catch (e) {
                            consoleOut(`"${fileUri}" 读取错误 : ${e.message}。`);
                            results.push(new Result(fileUri, '(读取错误)'));
                        }
                        if (fileCount === fileUris.length) {
                            resolve(results);
                        }
                    },
                    (reason: any) => {
                        consoleOut(`"${fileUri}" 读取错误 : ${reason}。`);
                        results.push(new Result(fileUri, '(读取错误)'));
                    });
                } else {
                    if (!ignoreUnsupportedFile) {
                        results.push(new Result(fileUri, '(不支持)'));
                    }
                    ++fileCount;
                    if (fileCount === fileUris.length) {
                        resolve(results);
                    }
                }
            });
        });
    });
}

type VscodeLanguage = {
    id: string 
    aliases?: string[] 
    filenames?: string[] 
    extensions?: string[] 
    configuration?: string
};
type LanguageConf = {
    aliases: string[]
    filenames: string[]
    extensions: string[]
    lineComments: string[]
    blockComments: [string,string][]
    blockStrings: [string,string][]
}
function pushUnique<T>(array: T[], ...values: T[]) {
    values.forEach(value => {
        if (array.indexOf(value) < 0) {
            array.push(value);
        }
    });
}
const append = (langs: Map<string, LanguageConf>, l:VscodeLanguage) => {
    const langExt = getOrSet(langs, l.id, ():LanguageConf => {
        return {
            aliases:[],
            filenames:[],
            extensions:[],
            lineComments:[], 
            blockComments:[],
            blockStrings:[]
        }
    });
    // l.aliases?.filter(v => langExt.aliases.indexOf(v) < 0).forEach(v => langExt.aliases.push(v));
    // l.filenames?.filter(v => langExt.filenames.indexOf(v) < 0).forEach(v => langExt.filenames.push(v));
    // l.extensions?.filter(v => langExt.extensions.indexOf(v) < 0).forEach(v => langExt.extensions.push(v));
    pushUnique(langExt.aliases, ...(l.aliases??[]));
    pushUnique(langExt.filenames, ...(l.filenames??[]));
    pushUnique(langExt.extensions, ...(l.extensions??[]));
    return langExt;
}

function collectLanguageConfigurations(langs: Map<string, LanguageConf>) : Promise<Map<string, LanguageConf>> {
    return new Promise((resolve: (values: Map<string, LanguageConf>)=> void, reject: (reason: any) => void) => {
        if (vscode.extensions.all.length <= 0) {
            resolve(langs);
        } else {
            let finishedCount = 0;
            let totalCount = 0;
            const decoderU8 = new TextDecoder('utf8');
            vscode.extensions.all.forEach(ex => {
                const languages = ex.packageJSON.contributes?.languages as VscodeLanguage[] ?? undefined;
                if (languages) {
                    totalCount += languages.length
                    languages.forEach(l => {
                        const langExt = append(langs, l);
                        if (l.configuration) {
                            const confUrl = vscode.Uri.file(path.join(ex.extensionPath, l.configuration));
                            vscode.workspace.fs.readFile(confUrl).then(data => {
                                // log(`${confUrl} ${data.length}B :${l.id}`);
                                const langConf = JSONC.parse(decoderU8.decode(data)) as vscode.LanguageConfiguration;
                                if (langConf.comments) {
                                    if (langConf.comments.lineComment) {
                                        pushUnique(langExt.lineComments, langConf.comments.lineComment);
                                    }
                                    if (langConf.comments.blockComment && langConf.comments.blockComment.length >= 2) {
                                        pushUnique(langExt.blockComments, langConf.comments.blockComment);
                                    }
                                }
                                if (++finishedCount >= totalCount) {
                                    resolve(langs);
                                }
                            },
                            (reason:any) => {
                                log(`${confUrl} : 错误 ${reason}`);
                                if (++finishedCount >= totalCount) {
                                    resolve(langs);
                                }
                            });
                
                        } else {
                            if (++finishedCount >= totalCount) {
                                resolve(langs);
                            }
                        }
                    });
                }
            });
        }
    });
}
function saveLanguageConfigurations_(langs: {[key:string]:LanguageConf}) {
    const conf = vscode.workspace.getConfiguration(CONFIGURATION_SECTION);
    const saveLocation = conf.get<string>('saveLocation', '全局设置');
    if (saveLocation === "全局设置") {
        conf.update('languages', langs, vscode.ConfigurationTarget.Global);
    } else if (saveLocation === "工作区设置") {
        conf.update('languages', langs, vscode.ConfigurationTarget.Workspace);
    } else if (saveLocation === "输出目录") {
        currentWorkspaceFolder().then(async (folder) => {
            if (!folder) return;
            const outputDirUri = buildUri(folder.uri, conf.get('outputDirectory', '.VSCodeCounter'));
            const uri = buildUri(outputDirUri, 'languages.json');
            await makeDirectories(outputDirUri);
            writeTextFile(uri, JSON.stringify(langs));
        });
    }
}
function saveLanguageConfigurations(langs: Map<string, LanguageConf>) {
    saveLanguageConfigurations_(mapToObject(langs));
}
async function loadLanguageConfigurations_() {
    const conf = vscode.workspace.getConfiguration(CONFIGURATION_SECTION);
    const saveLocation = conf.get<string>('saveLocation', '全局设置');
    if (saveLocation === "全局设置") {
        return conf.get<{[key:string]:LanguageConf}>('languages', {});
    } else if (saveLocation === "工作区设置") {
        return conf.get<{[key:string]:LanguageConf}>('languages', {});
    } else if (saveLocation === "输出目录") {
        const workFolder = await currentWorkspaceFolder();
        if (!workFolder) return {};
        const outputDirUri = buildUri(workFolder.uri, conf.get('outputDirectory', '.VSCodeCounter'));
        const uri = buildUri(outputDirUri, 'languages.json');
        const data = await vscode.workspace.fs.readFile(uri);
        const decoderU8 = new TextDecoder('utf8');
        return JSONC.parse(decoderU8.decode(data)) as {[key:string]:LanguageConf};
    } else {
        return {};
    }
}
async function loadLanguageConfigurations() {
    return objectToMap(await loadLanguageConfigurations_());
}
class LineCounterTable {
    private langExtensions: Map<string, LanguageConf>;
    private langIdTable: Map<string, LineCounter>;
    private aliasTable: Map<string, LineCounter>;
    private fileextRules: Map<string, LineCounter>;
    private filenameRules: Map<string, LineCounter>;
    private associations: [string, string][];

    constructor(langExtensions: Map<string, LanguageConf>, associations: [string, string][]) {
        this.langExtensions = langExtensions;
        this.langIdTable = new Map<string, LineCounter>();
        this.aliasTable = new Map<string, LineCounter>();
        this.fileextRules = new Map<string, LineCounter>();
        this.filenameRules = new Map<string, LineCounter>();
        this.associations = associations;
        log(`关联 : ${this.associations.length}\n[${this.associations.join("],[")}]`);
        langExtensions.forEach((lang, id) => {
            const langName = lang.aliases.length > 0 ? lang.aliases[0] : id;
            const lineCounter = new LineCounter(langName, lang.lineComments, lang.blockComments, lang.blockStrings);
            lang.aliases.forEach(v => this.aliasTable.set(v, lineCounter));
            lang.extensions.forEach(v => this.fileextRules.set(v.startsWith('.') ? v : `.${v}`, lineCounter));
            lang.filenames.forEach(v => this.filenameRules.set(v, lineCounter));
        });
    }
    public entries = () => this.langExtensions;

    public getById(langId: string) {
        return this.langIdTable.get(langId) || this.aliasTable.get(langId);
    }
    public getByPath(filePath: string) {
        const lineCounter = this.fileextRules.get(filePath) || this.fileextRules.get(path.extname(filePath)) || this.filenameRules.get(path.basename(filePath));
        if (lineCounter !== undefined) {
            return lineCounter; 
        }
        const patType = this.associations.find(([pattern, ]) => minimatch(filePath, pattern, {matchBase: true}));
        //log(`## ${filePath}: ${patType}`);
        return (patType !== undefined) ? this.getById(patType[1]) : undefined;
    }
    public getByUri(uri: vscode.Uri) {
        return this.getByPath(uri.fsPath);
    }
}

async function outputResults(workspaceUri: vscode.Uri, results: Result[], outputDirUri: vscode.Uri, conf: vscode.WorkspaceConfiguration) {
    const resultTable = new ResultTable(workspaceUri, results, conf.get('printNumberWithCommas', true) ? toStringWithCommas : (obj:any) => obj.toString() );
    const endOfLine = conf.get('endOfLine', '\n');
    log(`统计 ${results.length} 个文件`);
    if (results.length <= 0) {
        showError(`没有目标文件。`);
        return;
    }
    const previewType = conf.get<string>('outputPreviewType', '');
    log(`输出目录 : ${outputDirUri}`);
    await makeDirectories(outputDirUri);
    if (conf.get('outputAsText', true)) {
        const resultsUri = buildUri(outputDirUri, 'results.txt');
        const promise = writeTextFile(resultsUri, resultTable.toTextLines().join(endOfLine));
        if (previewType === 'text') {
            promise.then(() => showTextFile(resultsUri)).catch(err => showError(`输出文本失败。`, err));
        } else {
            promise.catch(err => showError(`输出文本失败。`, err));
        }
    }
    if (conf.get('outputAsCSV', true)) {
        const resultsUri = buildUri(outputDirUri, 'results.csv');
        const promise = writeTextFile(resultsUri, resultTable.toCSVLines().join(endOfLine));
        if (previewType === 'csv') {
            promise.then(() => showTextFile(resultsUri)).catch(err => showError(`输出 CSV 失败。`, err));
        } else {
            promise.catch(err => showError(`输出 CSV 失败。`, err));
        }
    }
    if (conf.get('outputAsMarkdown', true)) {
        const detailsUri = buildUri(outputDirUri, '详情.md');
        const resultsUri = buildUri(outputDirUri, '摘要.md');
        const promise = conf.get('outputMarkdownSeparately', true)
            ? writeTextFile(detailsUri, [
                    '# 详情',
                    '',
                    ...resultTable.toMarkdownHeaderLines(),
                    '',
                    `[摘要](摘要.md)`,
                    '',
                    ...resultTable.toMarkdownDetailsLines(),
                    '',
                    `[摘要](摘要.md)`,
                    ].join(endOfLine)
                ).then(() => writeTextFile(resultsUri, [
                    '# 摘要',
                    '',
                    ...resultTable.toMarkdownHeaderLines(),
                    '',
                    `[详情](详情.md)`,
                    '',
                    ...resultTable.toMarkdownSummaryLines(),
                    '',
                    `[详情](详情.md)`
                    ].join(endOfLine))
                )
            : writeTextFile(resultsUri, [
                    ...resultTable.toMarkdownHeaderLines(),
                    '',
                    ...resultTable.toMarkdownSummaryLines(),
                    '',
                    ...resultTable.toMarkdownDetailsLines(),
                    ].join(endOfLine)
                );
        if (previewType === 'markdown') {
            promise.then(() => vscode.commands.executeCommand("markdown.showPreview", resultsUri))
                .catch(err => showError(`输出 Markdown 失败。`, err));
        } else {
            promise.catch(err => showError(`输出 Markdown 失败。`, err));
        }
    }
}


class Result {
    public uri: vscode.Uri;
    public filename: string;
    public language: string;
    public code = 0;
    public comment = 0;
    public blank = 0;
    get total(): number {
        return this.code + this.comment + this.blank;
    }
    constructor(uri: vscode.Uri, language: string, value: {code:number, comment:number, blank:number} ={code:-1,comment:0,blank:0}) {
        this.uri = uri;
        this.filename = uri.fsPath;
        this.language = language;
        this.code = value.code;
        this.comment = value.comment;
        this.blank = value.blank;
    }
}
class Statistics {
    public name: string;
    public files = 0;
    public code = 0;
    public comment = 0;
    public blank = 0;
    get total(): number {
        return this.code + this.comment + this.blank;
    }
    constructor(name: string) {
        this.name = name;
    }
    public append(result: Result) {
        this.files++;
        this.code += result.code;
        this.comment += result.comment;
        this.blank += result.blank;
        return this;
    }
}
class MarkdownTableFormatter {
    private valueToString: (obj:any) => string;
    private columnInfo: {title:string, format:string}[];
    constructor(valueToString: (obj:any) => string, ...columnInfo: {title:string, format:string}[]) {
        this.valueToString = valueToString;
        this.columnInfo = columnInfo;
    }
    get lineSeparator() {
        return '| ' + this.columnInfo.map(i => (i.format === 'number') ? '---:' : ':---').join(' | ') + ' |';
    }
    get headerLines() {
        return ['| ' + this.columnInfo.map(i => i.title).join(' | ') + ' |', this.lineSeparator];
    }
    public line(...data: (string|number|vscode.Uri)[]) {
        return '| ' + data.map((d, i) => {
            if (typeof d === 'number') {
                return this.valueToString(d);
            }
            if (typeof d === 'string') {
                return d;
            }
            // return `[${path.relative(this.dir, d.fsPath)}](${d})`;
            return `[${vscode.workspace.asRelativePath(d)}](${vscode.workspace.asRelativePath(d)})`;
        }) .join(' | ') + ' |';
    }
}
class ResultTable {
    private targetDirPath: string;
    private fileResults: Result[] = [];
    private dirResultTable = new Map<string, Statistics>();
    private langResultTable = new Map<string, Statistics>();
    private total = new Statistics('总计');
    private valueToString: (obj:any) => string;

    constructor(workspaceUri: vscode.Uri, results:Result[], valueToString = (obj:any) => obj.toString()) {
        this.targetDirPath = workspaceUri.fsPath;
        this.fileResults = results;
        this.valueToString = valueToString;
        results
        .filter((result) => result.code >= 0)
        .forEach((result) => {
            let parent = path.dirname(path.relative(this.targetDirPath, result.filename));
            while (parent.length >= 0) {
                getOrSet(this.dirResultTable, parent, () => new Statistics(parent)).append(result);
                const p = path.dirname(parent);
                if (p === parent) {
                    break;
                }
                parent = p;
            }
            getOrSet(this.langResultTable, result.language, () => new Statistics(result.language)).append(result);
            this.total.append(result);
        });
    }
/*
    public toCSVLines() {
        const languages = [...this.langResultTable.keys()];
        return [
            `filename, language, ${languages.join(', ')}, comment, blank, total`,
            ...this.fileResults.sort((a,b) => a.filename < b.filename ? -1 : a.filename > b.filename ? 1 : 0)
                .map(v => `${v.filename}, ${v.language}, ${languages.map(l => l === v.language ? v.code : 0).join(', ')}, ${v.comment}, ${v.blank}, ${v.total}`),
            `Total, -, ${[...this.langResultTable.values()].map(r => r.code).join(', ')}, ${this.total.comment}, ${this.total.blank}, ${this.total.total}`
        ];
    }
*/
    public toCSVLines() {
        const languages = [...this.langResultTable.keys()];
        return [
            `"文件名", "语言", "${languages.join('", "')}", "注释", "空白", "总计"`,
            ...this.fileResults.sort((a,b) => a.filename < b.filename ? -1 : a.filename > b.filename ? 1 : 0)
                .map(v => `"${v.filename}", "${v.language}", ${languages.map(l => l === v.language ? v.code : 0).join(', ')}, ${v.comment}, ${v.blank}, ${v.total}`),
            `"总计", "-", ${[...this.langResultTable.values()].map(r => r.code).join(', ')}, ${this.total.comment}, ${this.total.blank}, ${this.total.total}`
        ];
    }
    public toTextLines() {
        class TextTableFormatter {
            private valueToString: (obj:any) => string;
            private columnInfo: {title:string, width:number}[];
            constructor(valueToString: (obj:any) => string, ...columnInfo: {title:string, width:number}[]) {
                this.valueToString = valueToString;
                this.columnInfo = columnInfo;
                for (const info of this.columnInfo) {
                    info.width = Math.max(info.title.length, info.width);
                }
            }
            public get lineSeparator() {
                return '+-' + this.columnInfo.map(i => '-'.repeat(i.width)).join('-+-') + '-+';
            }
            get headerLines() {
                return [this.lineSeparator, '| ' + this.columnInfo.map(i => i.title.padEnd(i.width)).join(' | ') + ' |', this.lineSeparator];
            }
            get footerLines() {
                return [this.lineSeparator];
            }
            public line(...data: (string|number|boolean)[]) {
                return '| ' + data.map((d, i) => {
                    if (typeof d === 'string') {
                        return d.padEnd(this.columnInfo[i].width);
                    } else {
                        return this.valueToString(d).padStart(this.columnInfo[i].width);
                    }
                }).join(' | ') + ' |';
            }
        }
        const maxNamelen = Math.max(...this.fileResults.map(res => res.filename.length));
        const maxLanglen = Math.max(...[...this.langResultTable.keys()].map(l => l.length));
        const resultFormat = new TextTableFormatter(this.valueToString, {title:'文件名', width:maxNamelen}, {title:'语言', width:maxLanglen}, 
            {title:'代码', width:10}, {title:'注释', width:10}, {title:'空白', width:10}, {title:'总计', width:10});
        const dirFormat = new TextTableFormatter(this.valueToString, {title:'路径', width:maxNamelen}, {title:'文件', width:10}, 
            {title:'代码', width:10}, {title:'注释', width:10}, {title:'空白', width:10}, {title:'总计', width:10});
        const langFormat = new TextTableFormatter(this.valueToString, {title:'语言', width:maxLanglen}, {title:'文件', width:10}, 
            {title:'代码', width:10}, {title:'注释', width:10}, {title:'空白', width:10}, {title:'总计', width:10});
        return [
            `日期 : ${dateToString(new Date())}`,
            `目录 : ${this.targetDirPath}`,
            // `Total : code: ${this.total.code}, comment : ${this.total.comment}, blank : ${this.total.blank}, all ${this.total.total} lines`,
            `总共 : ${this.total.files} 个文件,  ${this.total.code} 行代码, ${this.total.comment} 行注释, ${this.total.blank} 行空白, 共 ${this.total.total} 行`,
            '',
            '编程语言',
            ...langFormat.headerLines, 
            ...[...this.langResultTable.values()].sort((a,b) => b.code - a.code)
                .map(v => langFormat.line(v.name, v.files, v.code, v.comment, v.blank, v.total)),
            ...langFormat.footerLines, 
            '',
            '目录',
            ...dirFormat.headerLines, 
            ...[...this.dirResultTable.values()].sort((a,b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)
                .map(v => dirFormat.line(v.name, v.files, v.code, v.comment, v.blank, v.total)),
            ...dirFormat.footerLines, 
            '',
            '文件',
            ...resultFormat.headerLines, 
            ...this.fileResults.sort((a,b) => a.filename < b.filename ? -1 : a.filename > b.filename ? 1 : 0)
                .map(v => resultFormat.line(v.filename, v.language, v.code, v.comment, v.blank, v.total)),
            resultFormat.line('总计', '', this.total.code, this.total.comment, this.total.blank, this.total.total),
            ...resultFormat.footerLines, 
        ];
    }

    public toMarkdownHeaderLines() {
        return [
            `日期 : ${dateToString(new Date())}`,
            '',
            `目录 ${this.targetDirPath}`,
            '',
            `总共 : ${this.total.files} 个文件,  ${this.total.code} 行代码, ${this.total.comment} 行注释, ${this.total.blank} 行空白, 共 ${this.total.total} 行`,
        ];
    }
    public toMarkdownSummaryLines() {
        const dirFormat = new MarkdownTableFormatter(this.valueToString, 
            {title:'路径', format:'string'}, 
            {title:'文件', format:'number'}, 
            {title:'代码', format:'number'}, 
            {title:'注释', format:'number'}, 
            {title:'空白', format:'number'}, 
            {title:'总行数', format:'number'}
        );
        const langFormat = new MarkdownTableFormatter(this.valueToString, 
            {title:'编程语言', format:'string'}, 
            {title:'文件', format:'number'}, 
            {title:'代码', format:'number'}, 
            {title:'注释', format:'number'}, 
            {title:'空白', format:'number'}, 
            {title:'总行数', format:'number'}
        );
        return [
            '## 编程语言',
            ...langFormat.headerLines, 
            ...[...this.langResultTable.values()].sort((a,b) => b.code - a.code)
                .map(v => langFormat.line(v.name, v.files, v.code, v.comment, v.blank, v.total)),
            '',
            '## 目录',
            ...dirFormat.headerLines, 
            ...[...this.dirResultTable.values()].sort((a,b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)
                .map(v => dirFormat.line(v.name, v.files, v.code, v.comment, v.blank, v.total)),
        ];
    }
    public toMarkdownDetailsLines() {
        const resultFormat = new MarkdownTableFormatter(this.valueToString, 
            {title:'文件名', format:'uri'}, 
            {title:'编程语言', format:'string'}, 
            {title:'代码', format:'number'}, 
            {title:'注释', format:'number'}, 
            {title:'空白', format:'number'}, 
            {title:'总行数', format:'number'}
        );
        return [
            '## 文件',
            ...resultFormat.headerLines, 
            ...this.fileResults.sort((a,b) => a.filename < b.filename ? -1 : a.filename > b.filename ? 1 : 0)
                .map(v => resultFormat.line(v.uri, v.language, v.code, v.comment, v.blank, v.total)),
        ];
    }
}


function mapToObject<K,V>(map: Map<K,V>) {
    const obj: any = {}
    map.forEach((v,id)=>{
        obj[id] = v
    })
    return obj;
}
function objectToMap<V>(obj: {[key: string]: V}): Map<string,V> {
    return new Map<string, V>(Object.entries(obj));
}

function getOrSet<K,V>(map: Map<K,V>, key: K, otherwise: () => V) {
    let v = map.get(key);
    if (v === undefined) {
        v = otherwise();
        map.set(key, v);
    }
    return v;
}
function makeDirectories_(dirpath: vscode.Uri, resolve: ()=> void, reject: (reason: string) => void) {
    // log(`makeDirectories ${dirpath}`);
    vscode.workspace.fs.stat(dirpath).then((value) => {
        if (value.type === vscode.FileType.File) {
            reject(`${dirpath} 不是一个目录。`);
        } else {
            resolve();
        }
    }, (reason) => {
        log(`vscode.workspace.fs.stat 失败: ${reason}`);
        const curPath = dirpath.path;
        const parent = path.dirname(curPath);
        if (parent !== curPath) {
            makeDirectories_(dirpath.with({path: parent}), () => {
                log(`vscode.workspace.fs.createDirectory ${dirpath}`);
                vscode.workspace.fs.createDirectory(dirpath).then(resolve, reject);
            }, reject);
        } else {
            reject(reason);
        }
    });
}
function makeDirectories(dirpath: vscode.Uri): Promise<void> {
    return new Promise((resolve: ()=> void, reject: (reason: string) => void) => makeDirectories_(dirpath, resolve, reject));
}
function showTextFile(uri: vscode.Uri) {
    log(`显示文本文件 : ${uri}`);
    return new Promise((resolve: (editor: vscode.TextEditor)=> void, reject: (err: any) => void) => {
        vscode.workspace.openTextDocument(uri)
            .then((doc) => vscode.window.showTextDocument(doc, vscode.ViewColumn.One, true), reject)
            .then(resolve, reject);
    });
}
function writeTextFile(uri: vscode.Uri, text: string): Promise<void> {
    log(`写入文本文件 : ${uri} ${text.length}B`);
    return new Promise((resolve: ()=> void, reject: (err: any) => void) => {
        vscode.workspace.fs.writeFile(uri, new TextEncoder().encode(text)).then(resolve, reject);
    });
}
