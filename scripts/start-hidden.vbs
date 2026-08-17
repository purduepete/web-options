' Run the production launcher without allocating a visible console window.
' Task Scheduler invokes this with the absolute pwsh and serve.ps1 paths.

Option Explicit

Dim arguments
Set arguments = WScript.Arguments

If arguments.Count < 2 Then
    WScript.Quit 2
End If

Dim shell
Set shell = CreateObject("WScript.Shell")

Dim command
command = Quote(arguments(0)) & " -NoProfile -NonInteractive -File " & Quote(arguments(1))

If arguments.Count >= 3 Then
    command = command & " -Port " & arguments(2)
End If

Dim exitCode
exitCode = shell.Run(command, 0, True)
WScript.Quit exitCode

Function Quote(value)
    Quote = Chr(34) & value & Chr(34)
End Function
