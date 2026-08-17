' Run an arbitrary command with no visible console window.
' Generic version of start-hidden.vbs: arguments(0) is the executable, every
' argument after that is passed through untouched. Used by install-tls.ps1 to
' launch caddy.exe the same hidden way serve.ps1 launches pwsh.

Option Explicit

Dim arguments
Set arguments = WScript.Arguments

If arguments.Count < 1 Then
    WScript.Quit 2
End If

Dim shell
Set shell = CreateObject("WScript.Shell")

Dim command
command = Quote(arguments(0))

Dim i
For i = 1 To arguments.Count - 1
    command = command & " " & arguments(i)
Next

shell.Run command, 0, False
WScript.Quit 0

Function Quote(value)
    Quote = Chr(34) & value & Chr(34)
End Function
