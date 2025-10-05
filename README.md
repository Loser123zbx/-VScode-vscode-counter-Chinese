# 欢迎使用 VS Code 扩展

## 文件夹内容

* 此文件夹包含了您的扩展所需的所有文件。
* `package.json` - 这是清单文件，用于声明您的扩展和命令。
  * 示例插件注册了一个命令并定义其标题和命令名称。有了这些信息，VS Code 可以在命令面板中显示该命令。此时还不需要加载插件。
* `src/extension.ts` - 这是您将提供命令实现的主要文件。
  * 该文件导出一个函数 `activate`，它在您的扩展首次激活时被调用（在本例中是通过执行命令）。在 `activate` 函数内部，我们调用 `registerCommand`。
  * 我们将包含命令实现的函数作为第二个参数传递给 `registerCommand`。

## 立即开始运行

* 按 `F5` 打开一个新窗口并加载您的扩展。
* 通过按（`Ctrl+Shift+P` 或在 Mac 上按 `Cmd+Shift+P`）并输入 `Hello World`，从命令面板运行您的命令。
* 在 `src/extension.ts` 中设置断点以调试您的扩展。
* 在调试控制台中查找您的扩展的输出。

## 进行更改

* 在 `src/extension.ts` 中更改代码后，您可以从调试工具栏重新启动扩展。
* 您也可以通过重新加载（`Ctrl+R` 或在 Mac 上按 `Cmd+R`）VS Code 窗口来加载您的更改。

## 探索 API

* 当您打开文件 `node_modules/@types/vscode/index.d.ts` 时，可以查看我们完整的 API。

## 运行测试

* 打开调试视图（`Ctrl+Shift+D` 或在 Mac 上按 `Cmd+Shift+D`），从启动配置下拉菜单中选择 `Extension Tests`。
* 按 `F5` 在一个新窗口中运行测试并加载您的扩展。
* 在调试控制台中查看测试结果的输出。
* 更改 `src/test/suite/extension.test.ts` 或在 `test/suite` 文件夹中创建新的测试文件。
  * 提供的测试运行器只会考虑名称模式为 `**.test.ts` 的文件。
  * 您可以在 `test` 文件夹中创建文件夹，以任何方式组织您的测试。

## 进一步探索

 * 通过[打包您的扩展](https://code.visualstudio.com/api/working-with-extensions/bundling-extension)来减少扩展大小并提高启动速度。
 * 在 VSCode 扩展市场上[发布您的扩展](https://code.visualstudio.com/api/working-with-extensions/publishing-extension)。
 * 通过设置[持续集成](https://code.visualstudio.com/api/working-with-extensions/continuous-integration)来自动化构建。
