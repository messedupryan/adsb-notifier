{{- define "adsb-notifier.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "adsb-notifier.fullname" -}}
{{- if .Values.fullnameOverride -}}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" -}}
{{- else -}}
{{- include "adsb-notifier.name" . -}}
{{- end -}}
{{- end -}}

{{- define "adsb-notifier.labels" -}}
app.kubernetes.io/name: {{ include "adsb-notifier.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
helm.sh/chart: {{ .Chart.Name }}-{{ .Chart.Version | replace "+" "_" }}
{{- end -}}

{{- define "adsb-notifier.selectorLabels" -}}
app.kubernetes.io/name: {{ include "adsb-notifier.name" . }}
{{- end -}}

{{- define "adsb-notifier.componentLabels" -}}
{{ include "adsb-notifier.labels" .root }}
app.kubernetes.io/component: {{ .component }}
{{- end -}}

{{- define "adsb-notifier.componentSelectorLabels" -}}
{{ include "adsb-notifier.selectorLabels" .root }}
app.kubernetes.io/component: {{ .component }}
{{- end -}}

{{- define "adsb-notifier.image" -}}
{{- printf "%s/%s:%s" .root.Values.image.registry .repository .root.Values.image.tag -}}
{{- end -}}

{{- define "adsb-notifier.secretName" -}}
{{- default (printf "%s-secrets" (include "adsb-notifier.fullname" .)) .Values.secret.name -}}
{{- end -}}

{{- define "adsb-notifier.pvcName" -}}
{{- if .Values.persistence.existingClaim -}}
{{- .Values.persistence.existingClaim -}}
{{- else -}}
{{- printf "%s-config" (include "adsb-notifier.fullname" .) -}}
{{- end -}}
{{- end -}}
