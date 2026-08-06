<template>
  <div :class="['api-key-panel', {page: !embedded}]">
    <div class="header">
      <div>
        <div class="title">{{ $t('apiKeys') }}</div>
        <div class="desc">{{ $t('apiKeyLimitDesc', {count: maxActiveKeys}) }}</div>
      </div>
      <div class="actions">
        <el-button @click="openDocs">{{ $t('apiDocs') }}</el-button>
        <el-button type="primary" :disabled="!enabled" @click="openCreate">
          {{ $t('createApiKey') }}
        </el-button>
      </div>
    </div>

    <el-alert
        v-if="!enabled"
        :title="$t('restApiDisabledDesc')"
        type="warning"
        :closable="false"
        show-icon
    />

    <el-table v-loading="loading" :data="keys" class="table">
      <el-table-column prop="name" :label="$t('apiKeyName')" min-width="150"/>
      <el-table-column prop="keyPrefix" label="API Key" min-width="245" show-overflow-tooltip/>
      <el-table-column :label="$t('tabStatus')" width="100">
        <template #default="{row}">
          <el-tag :type="row.status === 0 ? 'success' : 'info'">
            {{ row.status === 0 ? $t('apiKeyActive') : $t('apiKeyRevokedStatus') }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column prop="expireTime" :label="$t('validUntil')" min-width="165">
        <template #default="{row}">{{ row.expireTime || $t('unlimited') }}</template>
      </el-table-column>
      <el-table-column prop="lastUsedIp" :label="$t('lastUsedIp')" min-width="135">
        <template #default="{row}">{{ row.lastUsedIp || '-' }}</template>
      </el-table-column>
      <el-table-column prop="lastUsedTime" :label="$t('apiKeyLastUsedAt')" min-width="170">
        <template #default="{row}">{{ row.lastUsedTime || $t('apiKeyNeverUsed') }}</template>
      </el-table-column>
      <el-table-column :label="$t('action')" width="255" fixed="right">
        <template #default="{row}">
          <el-button size="small" @click="view(row)">{{ $t('details') }}</el-button>
          <el-button v-if="row.status === 0" size="small" @click="openEdit(row)">
            {{ $t('change') }}
          </el-button>
          <el-button v-if="row.status === 0" size="small" type="danger" @click="revoke(row)">
            {{ $t('revokeApiKey') }}
          </el-button>
        </template>
      </el-table-column>
      <template #empty>
        <el-empty :description="$t('noApiKeys')"/>
      </template>
    </el-table>

    <el-dialog v-model="createShow" :title="$t('createApiKey')" width="520">
      <el-form label-position="top">
        <el-form-item :label="$t('apiKeyName')">
          <el-input v-model="form.name" maxlength="50" show-word-limit/>
        </el-form-item>
        <el-form-item :label="$t('ipWhitelist')">
          <el-input-tag v-model="form.ipWhitelist" placeholder="1.2.3.4, 2001:db8::1"/>
        </el-form-item>
        <el-form-item :label="$t('validity')">
          <div class="validity">
            <el-switch v-model="form.permanent" :active-text="$t('unlimited')"/>
            <el-date-picker
                v-if="!form.permanent"
                v-model="form.expireTime"
                type="datetime"
                value-format="YYYY-MM-DD HH:mm:ss"
            />
          </div>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="createShow=false">{{ $t('cancel') }}</el-button>
        <el-button type="primary" :loading="saving" @click="create">{{ $t('confirm') }}</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="editShow" :title="$t('change')" width="520">
      <el-form label-position="top">
        <el-form-item :label="$t('apiKeyName')">
          <el-input v-model="editForm.name" maxlength="50" show-word-limit/>
        </el-form-item>
        <el-form-item :label="$t('ipWhitelist')">
          <el-input-tag v-model="editForm.ipWhitelist" placeholder="1.2.3.4, 2001:db8::1"/>
        </el-form-item>
        <el-form-item :label="$t('validity')">
          <div class="validity">
            <el-switch v-model="editForm.permanent" :active-text="$t('unlimited')"/>
            <el-date-picker
                v-if="!editForm.permanent"
                v-model="editForm.expireTime"
                type="datetime"
                value-format="YYYY-MM-DD HH:mm:ss"
            />
          </div>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="editShow=false">{{ $t('cancel') }}</el-button>
        <el-button type="primary" :loading="saving" @click="saveEdit">{{ $t('save') }}</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="viewShow" :title="$t('details')" width="650">
      <el-descriptions v-if="selected" :column="1" border>
        <el-descriptions-item label="API Key">
          <code class="key">{{ selected.apiKey }}</code>
          <el-button link type="primary" @click="copy(selected.apiKey)">{{ $t('copy') }}</el-button>
        </el-descriptions-item>
        <el-descriptions-item :label="$t('ipWhitelist')">
          {{ selected.ipWhitelist?.join(', ') || $t('unlimited') }}
        </el-descriptions-item>
        <el-descriptions-item :label="$t('validUntil')">
          {{ selected.expireTime || $t('unlimited') }}
        </el-descriptions-item>
        <el-descriptions-item :label="$t('lastUsedIp')">
          {{ selected.lastUsedIp || '-' }}
        </el-descriptions-item>
        <el-descriptions-item :label="$t('apiKeyLastUsedAt')">
          {{ selected.lastUsedTime || $t('apiKeyNeverUsed') }}
        </el-descriptions-item>
        <el-descriptions-item :label="$t('lastRequest')">
          <pre>{{ formatRequest(selected.lastRequest) }}</pre>
        </el-descriptions-item>
      </el-descriptions>
    </el-dialog>

    <el-dialog
        v-model="generatedShow"
        :title="$t('apiKeyOneTimeTitle')"
        width="650"
        :close-on-click-modal="false"
    >
      <el-alert :title="$t('apiKeyOneTimeDesc')" type="success" :closable="false" show-icon/>
      <el-input v-model="generatedKey" readonly class="generated-key">
        <template #append>
          <el-button @click="copy(generatedKey)">{{ $t('copy') }}</el-button>
        </template>
      </el-input>
    </el-dialog>
  </div>
</template>

<script setup>
import {onMounted, reactive, ref} from 'vue'
import {useI18n} from 'vue-i18n'
import {
  apiKeyStatus,
  apiKeyCreate,
  apiKeyUpdate,
  apiKeyRevoke
} from '@/request/api-key.js'

defineProps({
  embedded: {
    type: Boolean,
    default: false
  }
})

const {t} = useI18n()
const keys = ref([])
const enabled = ref(false)
const maxActiveKeys = ref(10)
const loading = ref(false)
const saving = ref(false)
const createShow = ref(false)
const editShow = ref(false)
const viewShow = ref(false)
const generatedShow = ref(false)
const generatedKey = ref('')
const selected = ref(null)
const editTargetId = ref(null)
const form = reactive({
  name: '',
  ipWhitelist: [],
  permanent: true,
  expireTime: null
})
const editForm = reactive({
  name: '',
  ipWhitelist: [],
  permanent: true,
  expireTime: null
})

function load() {
  loading.value = true
  apiKeyStatus().then(data => {
    keys.value = data.list || []
    enabled.value = data.enabled
    maxActiveKeys.value = data.maxActiveKeys || 10
  }).finally(() => loading.value = false)
}

function openCreate() {
  Object.assign(form, {
    name: '',
    ipWhitelist: [],
    permanent: true,
    expireTime: null
  })
  createShow.value = true
}

function create() {
  if (!form.name.trim() || saving.value) return
  saving.value = true
  apiKeyCreate({...form}).then(data => {
    generatedKey.value = data.apiKey
    createShow.value = false
    generatedShow.value = true
    ElMessage.success(t('apiKeyCreated'))
    load()
  }).finally(() => saving.value = false)
}

function openEdit(row) {
  editTargetId.value = row.apiKeyId
  Object.assign(editForm, {
    name: row.name,
    ipWhitelist: [...(row.ipWhitelist || [])],
    permanent: row.permanent,
    expireTime: row.expireTime
  })
  editShow.value = true
}

function saveEdit() {
  if (!editForm.name.trim() || saving.value) return
  saving.value = true
  apiKeyUpdate(editTargetId.value, {...editForm}).then(() => {
    editShow.value = false
    ElMessage.success(t('saveSuccessMsg'))
    load()
  }).finally(() => saving.value = false)
}

function revoke(row) {
  ElMessageBox.confirm(t('revokeApiKeyConfirm'), {
    confirmButtonText: t('confirm'),
    cancelButtonText: t('cancel'),
    type: 'warning'
  }).then(() => apiKeyRevoke(row.apiKeyId)).then(() => {
    ElMessage.success(t('apiKeyRevoked'))
    load()
  })
}

function view(row) {
  selected.value = row
  viewShow.value = true
}

async function copy(value) {
  try {
    await navigator.clipboard.writeText(value)
    ElMessage.success(t('copySuccessMsg'))
  } catch {
    ElMessage.error(t('copyFailMsg'))
  }
}

function formatRequest(value) {
  if (!value) return '-'
  try {
    return JSON.stringify(JSON.parse(value), null, 2)
  } catch {
    return value
  }
}

function openDocs() {
  window.open('/api-docs.html', '_blank', 'noopener,noreferrer')
}

onMounted(load)
</script>

<style scoped>
.api-key-panel {
  display: flex;
  flex-direction: column;
  gap: 16px;
  min-width: 0;
}
.api-key-panel.page {
  padding: 40px;
}
.header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 16px;
  flex-wrap: wrap;
}
.title {
  font-size: 18px;
  font-weight: bold;
}
.desc {
  color: var(--regular-text-color);
  font-size: 13px;
  margin-top: 6px;
}
.actions {
  display: flex;
  gap: 10px;
}
.table {
  width: 100%;
}
.validity {
  display: flex;
  align-items: center;
  gap: 14px;
  flex-wrap: wrap;
}
.key {
  overflow-wrap: anywhere;
  margin-right: 8px;
}
.generated-key {
  margin-top: 18px;
}
pre {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  margin: 0;
}
@media (max-width: 767px) {
  .api-key-panel.page {
    padding: 30px;
  }
  .header {
    align-items: flex-start;
    flex-direction: column;
  }
}
</style>