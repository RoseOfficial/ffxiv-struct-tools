using System;
using System.Collections.Generic;

namespace StructValidator;

/// <summary>
/// Complete validation report for export.
/// </summary>
public class ValidationReport
{
    public DateTime Timestamp { get; set; }
    public string GameVersion { get; set; } = "";
    public ValidationSummary Summary { get; set; } = new();
    public List<StructValidationResult> Results { get; set; } = new();
}

/// <summary>
/// Summary statistics for a validation run.
/// </summary>
public class ValidationSummary
{
    public int TotalStructs { get; set; }
    public int PassedStructs { get; set; }
    public int FailedStructs { get; set; }
    public int TotalIssues { get; set; }
    public int ErrorCount { get; set; }
    public int WarningCount { get; set; }
    public int InfoCount { get; set; }
}

/// <summary>
/// Validation result for a single struct.
/// </summary>
public class StructValidationResult
{
    public string StructName { get; set; } = "";
    public string Namespace { get; set; } = "";
    public bool Passed { get; set; }
    public int? DeclaredSize { get; set; }
    public int? ActualSize { get; set; }
    public string? BaseType { get; set; }
    public int? BaseTypeSize { get; set; }
    public List<ValidationIssue> Issues { get; set; } = new();
    public List<FieldValidation>? FieldValidations { get; set; }
}

/// <summary>
/// A single validation issue.
/// </summary>
public class ValidationIssue
{
    public string Severity { get; set; } = "info";
    public string Rule { get; set; } = "";
    public string? Field { get; set; }
    public string Message { get; set; } = "";
    public string? Expected { get; set; }
    public string? Actual { get; set; }
}

/// <summary>
/// Field validation details.
/// </summary>
public class FieldValidation
{
    public string Name { get; set; } = "";
    public int Offset { get; set; }
    public string Type { get; set; } = "";
    public int Size { get; set; }
}
