{{- define "aiontheballot-api.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{- define "aiontheballot-api.fullname" -}}
{{- if .Values.fullnameOverride }}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- $name := default .Chart.Name .Values.nameOverride }}
{{- if contains $name .Release.Name }}
{{- .Release.Name | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" }}
{{- end }}
{{- end }}
{{- end }}

{{- define "aiontheballot-api.labels" -}}
helm.sh/chart: {{ printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
{{ include "aiontheballot-api.selectorLabels" . }}
app.kubernetes.io/version: {{ .Values.image.tag | default .Chart.AppVersion | quote }}
app.kubernetes.io/part-of: aiontheballot
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end }}

{{- define "aiontheballot-api.selectorLabels" -}}
app.kubernetes.io/name: {{ include "aiontheballot-api.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}

{{/* The fetcher's own selector labels (ADR-0007): never the API's, which its Service selects. */}}
{{- define "aiontheballot-api.fetcherSelectorLabels" -}}
app.kubernetes.io/name: {{ include "aiontheballot-api.name" . }}-fetcher
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}

{{/* The worker's own selector labels (PLAN R116): never the API's, which its Service selects. */}}
{{- define "aiontheballot-api.workerSelectorLabels" -}}
app.kubernetes.io/name: {{ include "aiontheballot-api.name" . }}-worker
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}
