<template>
  <div class="page">
    <div class="header">
      <div>
        <h2>{{ $t('apiKeys') }}</h2>
        <p>{{ $t('apiKeyLimitDesc', {count: 10}) }}</p>
      </div>
      <div class="actions">
        <el-button @click="windowOpenDocs">{{ $t('apiDocs') }}</el-button>
        <el-button type="primary" :disabled="!enabled && !isAdmin" @click="openCreate">
          {{ $t('createApiKey') }}
        </el-button>
      </div>
    </div>

    <el-card v-if="isAdmin" class="admin-card">
      <div class="settings-grid">
        <div class="switch-row">
          <div>
            <strong>{{ $t('restApiAccess') }}</strong>
            <div class="desc">{{ $t('restApiAccessDesc') }}</div>
          </div>
          <el-switch v-model="adminSettings.restApiEnabled"
                     :active-value="0" :inactive-value="1"
                     :loading="switchLoading"
                     @change="saveAdminSetting('restApiEnabled', $event)"/>
        </div>
        <div class="switch-row">
          <div>
            <strong>{{ $t('multipleEmail') }}</strong>
          </div>
          <el-switch v-model="adminSettings.manyEmail"
                     :active-value="0" :inactive-value="1"
                     :loading="switchLoading"
                     @change="saveAdminSetting('manyEmail', $event)"/>
        </div>
        <div class="switch-row">
          <div>
            <strong>{{ $t('addAccount') }}</strong>
          </div>
          <el-switch v-model="adminSettings.addEmail"
                     :active-value="0" :inactive-value="1"
                     :loading="switchLoading"
                     @change="saveAdminSetting('addEmail', $event)"/>
        </div>
      </div>
      <el-form inline>
        <el-form-item :label="$t('userId')"><el-input v-model="filters.userId" clearable/></el-form-item>
        <el-form-item :label="$t('userEmail')"><el-input v-model="filters.email" clearable/></el-form-item>
        <el-form-item :label="$t('apiKeyName')"><el-input v-model="filters.name" clearable/></el-form-item>
        <el-button @click="load">{{ $t('searchUser') }}</el-button>
      </el-form>
    </el-card>

    <el-alert v-if="!enabled" :title="$t('restApiDisabledDesc')" type="warning"
              :closable="false" show-icon/>

    <el-table v-loading="loading" :data="keys" class="table">
      <el-table-column v-if="isAdmin" prop="userEmail" :label="$t('userEmail')" min-width="190"/>
      <el-table-column prop="name" :label="$t('apiKeyName')" min-width="150"/>
      <el-table-column v-if="isAdmin" :label="$t('apiKeyType')" width="130">
        <template #default="{row}">
          <el-tag :type="row.isAdmin ? 'danger' : ''">
            {{ row.isAdmin ? $t('adminApiKey') : $t('userApiKey') }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column prop="keyPrefix" label="API Key" min-width="260" show-overflow-tooltip/>
      <el-table-column :label="$t('tabStatus')" width="100">
        <template #default="{row}">
          <el-tag :type="row.status === 0 ? 'success' : 'info'">
            {{ row.status === 0 ? $t('apiKeyActive') : $t('apiKeyRevokedStatus') }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column prop="expireTime" :label="$t('validUntil')" min-width="160">
        <template #default="{row}">{{ row.expireTime || $t('unlimited') }}</template>
      </el-table-column>
      <el-table-column prop="lastUsedIp" :label="$t('lastUsedIp')" min-width="130"/>
      <el-table-column prop="lastUsedTime" :label="$t('apiKeyLastUsedAt')" min-width="165"/>
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
    </el-table>

    <el-dialog v-model="createShow" :title="$t('createApiKey')" width="520">
      <el-form label-position="top">
        <el-form-item v-if="isAdmin" :label="$t('apiKeyType')">
          <el-switch v-model="form.isAdmin" :active-text="$t('adminApiKey')"
                     :inactive-text="$t('userApiKey')"/>
        </el-form-item>
        <el-form-item v-if="isAdmin && !form.isAdmin" :label="$t('userId')">
          <el-input-number v-model="form.userId" :min="1"/>
        </el-form-item>
        <el-form-item :label="$t('apiKeyName')">
          <el-input v-model="form.name" maxlength="50"/>
        </el-form-item>
        <el-form-item :label="$t('ipWhitelist')">
          <el-input-tag v-model="form.ipWhitelist" placeholder="1.2.3.4, 2001:db8::1"/>
        </el-form-item>
        <el-form-item :label="$t('validity')">
          <el-switch v-model="form.permanent" :active-text="$t('unlimited')"/>
          <el-date-picker v-if="!form.permanent" v-model="form.expireTime"
                          type="datetime" value-format="YYYY-MM-DD HH:mm:ss"/>
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
          <el-input v-model="editForm.name" maxlength="50"/>
        </el-form-item>
        <el-form-item :label="$t('ipWhitelist')">
          <el-input-tag v-model="editForm.ipWhitelist" placeholder="1.2.3.4, 2001:db8::1"/>
        </el-form-item>
        <el-form-item :label="$t('validity')">
          <el-switch v-model="editForm.permanent" :active-text="$t('unlimited')"/>
          <el-date-picker v-if="!editForm.permanent" v-model="editForm.expireTime"
                          type="datetime" value-format="YYYY-MM-DD HH:mm:ss"/>
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
        <el-descriptions-item :label="$t('lastUsedIp')">{{ selected.lastUsedIp || '-' }}</el-descriptions-item>
        <el-descriptions-item :label="$t('apiKeyLastUsedAt')">
          {{ selected.lastUsedTime || $t('apiKeyNeverUsed') }}
        </el-descriptions-item>
        <el-descriptions-item :label="$t('lastRequest')">
          <pre>{{ formatRequest(selected.lastRequest) }}</pre>
        </el-descriptions-item>
      </el-descriptions>
    </el-dialog>
  </div>
</template>

<script setup>
import {computed, onMounted, reactive, ref} from 'vue'
import {useI18n} from 'vue-i18n'
import {useUserStore} from '@/store/user.js'
import {settingSet} from '@/request/setting.js'
import {
  apiKeyStatus, apiKeyCreate, apiKeyUpdate, apiKeyRevoke,
  adminApiKeyList, adminApiKeyCreate, adminApiKeyUpdate, adminApiKeyRevoke
} from '@/request/api-key.js'

const {t} = useI18n()
const userStore = useUserStore()
const isAdmin = computed(() => userStore.user.type === 0)
const keys = ref([])
const enabled = ref(false)
const enabledValue = ref(1)
const adminSettings = reactive({
  restApiEnabled: 1,
  manyEmail: 1,
  addEmail: 1
})
const loading = ref(false)
const saving = ref(false)
const switchLoading = ref(false)
const createShow = ref(false)
const editShow = ref(false)
const viewShow = ref(false)
const selected = ref(null)
const editTargetId = ref(null)
const filters = reactive({userId: '', email: '', name: ''})
const form = reactive({
  name: '', userId: 1, isAdmin: false, ipWhitelist: [], permanent: true, expireTime: null
})
const editForm = reactive({
  name: '', ipWhitelist: [], permanent: true, expireTime: null
})

function load() {
  loading.value = true
  const request = isAdmin.value ? adminApiKeyList(filters) : apiKeyStatus()
  request.then(data => {
    keys.value = data.list
    enabled.value = data.enabled
    enabledValue.value = data.enabled ? 0 : 1
    if (data.settings) {
      Object.assign(adminSettings, data.settings)
    }
  }).finally(() => loading.value = false)
}

function openCreate() {
  form.name = ''
  form.userId = userStore.user.userId
  form.isAdmin = false
  form.ipWhitelist = []
  form.permanent = true
  form.expireTime = null
  createShow.value = true
}

function create() {
  if (!form.name.trim()) return
  saving.value = true
  const payload = {...form}
  const request = isAdmin.value ? adminApiKeyCreate(payload) : apiKeyCreate(payload)
  request.then(() => {
    createShow.value = false
    ElMessage.success(t('apiKeyCreated'))
    load()
  }).finally(() => saving.value = false)
}

function openEdit(row) {
  editTargetId.value = row.apiKeyId
  editForm.name = row.name
  editForm.ipWhitelist = [...(row.ipWhitelist || [])]
  editForm.permanent = row.permanent
  editForm.expireTime = row.expireTime
  editShow.value = true
}

function saveEdit() {
  saving.value = true
  const payload = {...editForm}
  const request = isAdmin.value
      ? adminApiKeyUpdate(editTargetId.value, payload)
      : apiKeyUpdate(editTargetId.value, payload)
  request.then(() => {
    editShow.value = false
    ElMessage.success(t('saveSuccessMsg'))
    load()
  }).finally(() => saving.value = false)
}

function revoke(row) {
  ElMessageBox.confirm(t('revokeApiKeyConfirm')).then(() => {
    const request = isAdmin.value ? adminApiKeyRevoke(row.apiKeyId) : apiKeyRevoke(row.apiKeyId)
    request.then(() => {
      ElMessage.success(t('apiKeyRevoked'))
      load()
    })
  })
}

function view(row) {
  selected.value = row
  viewShow.value = true
}

function copy(value) {
  navigator.clipboard.writeText(value).then(() => ElMessage.success(t('copySuccessMsg')))
}

function formatRequest(value) {
  if (!value) return '-'
  try { return JSON.stringify(JSON.parse(value), null, 2) } catch { return value }
}

function saveAdminSetting(key, value) {
  switchLoading.value = true
  settingSet({[key]: value}).then(() => {
    if (key === 'restApiEnabled') {
      enabled.value = value === 0
      enabledValue.value = value
    }
    load()
  }).finally(() => switchLoading.value = false)
}

function windowOpenDocs() {
  window.open('/api-docs.html', '_blank', 'noopener,noreferrer')
}

onMounted(load)
</script>

<style scoped>
.page { padding: 24px; display: grid; gap: 18px; }
.header, .switch-row { display: flex; justify-content: space-between; align-items: center; gap: 16px; }
.header h2 { margin: 0; }
.header p, .desc { color: var(--el-text-color-secondary); margin: 6px 0 0; }
.actions { display: flex; gap: 10px; }
.table { width: 100%; }
.admin-card { margin-bottom: 2px; }
.settings-grid { display: grid; gap: 14px; margin-bottom: 18px; }
.switch-row { display: flex; justify-content: space-between; align-items: center; gap: 16px; }
.key { overflow-wrap: anywhere; margin-right: 8px; }
pre { white-space: pre-wrap; overflow-wrap: anywhere; margin: 0; }
@media (max-width: 700px) {
  .page { padding: 14px; }
  .header { align-items: flex-start; flex-direction: column; }
}
</style>