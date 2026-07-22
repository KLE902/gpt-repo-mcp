Option Explicit

If WScript.Arguments.Count <> 3 Then
    WScript.Quit 2
End If

Dim repoPath, nodePath, npmCli, supervisorPath
repoPath = WScript.Arguments.Item(0)
nodePath = WScript.Arguments.Item(1)
npmCli = WScript.Arguments.Item(2)
supervisorPath = repoPath & "\scripts\runtime-supervisor.mjs"

Dim fileSystem
Set fileSystem = CreateObject("Scripting.FileSystemObject")
If Not fileSystem.FileExists(nodePath) Then WScript.Quit 3
If Not fileSystem.FileExists(npmCli) Then WScript.Quit 4
If Not fileSystem.FileExists(supervisorPath) Then WScript.Quit 5

Function QuoteArgument(value)
    QuoteArgument = Chr(34) & Replace(value, Chr(34), Chr(34) & Chr(34)) & Chr(34)
End Function

Dim command, shell
command = QuoteArgument(nodePath) & " " & QuoteArgument(supervisorPath) & _
    " --repo " & QuoteArgument(repoPath) & _
    " --npm-cli " & QuoteArgument(npmCli)

Set shell = CreateObject("WScript.Shell")
shell.CurrentDirectory = repoPath
WScript.Quit shell.Run(command, 0, True)
