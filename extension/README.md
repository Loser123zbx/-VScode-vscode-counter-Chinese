# VScode Counter

VS Code 扩展：用于统计多种编程语言源代码中的空行、注释行和总行数。

* [github](https://github.com/uctakeoff/vscode-counter)
* [Marketplace](https://marketplace.visualstudio.com/items?itemName=uctakeoff.vscode-counter)

## VSCode Counter 2.0 已发布！

* 实验性支持"**VSCode 远程开发**"。

    在 *VSCode 远程开发* 中使用 VSCode Counter 时，您需要使用 `保存语言配置` 功能。
    [更多信息请参见下文](#save-language-configurations)。

## 功能

- 统计工作区或目录中源代码的代码行数。
- 实时统计当前文件的代码行数。

## 使用方法

### 统计工作区

* 打开命令面板，选择 `VSCodeCounter: Count lines in workspace`。

    ![](images/count_workspace.gif)


### 统计任意目录

* 打开资源管理器，右键单击文件夹。
* 选择 `Count lines in directory`。

    ![](images/from_menu.gif)


### 实时计数器

* 打开命令面板，选择 `VSCodeCounter: Toggle Real-time Counter Visibility`。

    ![](images/realtime_counter.png)

### 查看可用语言

* 打开命令面板，选择 `VSCodeCounter: Check available languages`。
    ![](images/avail_langs.png)

    * 可通过添加语言扩展来增加可用语言。

### 保存语言配置

**VSCode Counter** 能够通过参考已安装语言扩展中的信息来聚合未知语言。但是，我发现**这些信息在远程开发中不可用**。

因此，VSCode Counter 的**收集 VSCode 语言扩展**功能现在作为独立功能调用。思路是在本地环境中收集一次信息并存储，以便在远程环境中使用。

* 首先，在本地服务器上启动 VSCode。
* 然后，打开命令面板，选择 `VSCodeCounter: Save the collected language configurations`。
* 然后 *settings.json* 将存储从当前语言扩展收集的配置信息。
    ![](images/save_lang.png)
* 连接到远程，照常使用 VSCodecounter。

您也可以更改配置的存储位置。
但是，您必须自行将存储的信息带到远程环境。

## 扩展设置

* `VSCodeCounter.useGitignore`: 是否使用 '.gitignore' 文件来排除文件。
* `VSCodeCounter.useFilesExclude`: 是否使用设置 'files.exclude' 来排除文件。
* `VSCodeCounter.printNumberWithCommas`: 是否打印带有千位分隔符逗号的数字（CSV 除外）。
* `VSCodeCounter.ignoreUnsupportedFile`: 忽略不支持的文件。
* `VSCodeCounter.endOfLine`: 输出文件中使用的换行符。
* `VSCodeCounter.include`: 配置包含文件和文件夹的 glob 模式。
* `VSCodeCounter.exclude`: 配置排除文件和文件夹的 glob 模式。
* `VSCodeCounter.outputDirectory`: 输出结果的目录路径。
* `VSCodeCounter.outputAsText`: 是否将结果输出为文本文件。
* `VSCodeCounter.outputAsCSV`: 是否将结果输出为 CSV 文件。
* `VSCodeCounter.outputAsMarkdown`: 是否将结果输出为 Markdown 文件。
* `VSCodeCounter.outputPreviewType`: 计数后预览的输出文件类型。从 `text`、`csv`、`markdown` 或 `none` 中选择。
* `VSCodeCounter.saveLocation`: 指定存储收集的语言配置的位置。

**祝您使用愉快！**
