<template>
  <div class="settings-container">
    <el-scrollbar class="scroll">
      <div class="scroll-body">
        <div class="settings-card">
          <div class="card-title">{{ $t('apiAccessControl') }}</div>
          <div class="card-content">
            <div class="setting-item">
              <div>
                <strong>{{ $t('userRestApiAccess') }}</strong>
                <div class="description">{{ $t('userRestApiAccessDesc') }}</div>
              </div>
              <el-switch
                  v-model="settings.restApiEnabled"
                  :active-value="0"
                  :inactive-value="1"
                  :loading="switchLoading"
                  @change="saveSwitch('restApiEnabled', $event)"
              />
            </div>
            <div class="setting-item">
              <div>
                <strong>{{ $t('adminRestApiAccess') }}</strong>
                <div class="description">{{ $t('adminRestApiAccessDesc') }}</div>
              </div>
              <el-switch
                  v-model="settings.adminRestApiEnabled"
                  :active-value="0"
                  :inactive-value="1"
                  :loading="switchLoading"
                  @change="saveSwitch('adminRestApiEnabled', $event)"
              />
            </div>
          </div>
        </div>

        <div class="settings-card key-card">
          <div class="card-title card-title-actions">
            <span>{{ $t('apiKeyManagement') }}</span>
            <div>
              <el-button @click="openDocs">{{ $t('apiDocs') }}</el-button>
              <el-button type="primary" @click="openCreate">{{ $t('createApiKey') }}</el-button>
            </div>
          </div>

          <el-tabs v-model="activeType" @tab-change="load">
            <el-tab-pane :label="$t('userApiKeys')" name="0"/>
            <el-tab-pane :label="$t('adminApiKeys')" name="1"/>
          </el-tabs>

          <el-form class="filters" inline>
            <el-form-item :label="$t('userId')">
              <el-input v-model="filters.userId" clearable/>
            </el-form-item>
            <el-form-item :label="$t('userEmail')">
              <el-input v-model="filters.email" clearable/>
            </el-form-item>
            <el-form-item :label="$t('apiKeyName')">
              <el-input v-model="filters.name" clearable/>
            </el-form-item>
            <el-form-item :label="$t('tabStatus')">
              <el-select v-model="filters.status" clearable style="width: 130px">
                <el-option :label="$t('apiKeyActive')" :value="0"/>
                <el-option :label="$t('apiKeyRevokedStatus')" :value="1"/>
              </el-select>
            </el-form-item>
            <el-form-item>
              <el-button type="primary" @click="load">{{ $t('searchUser') }}</el-button>
              <el-button @click="resetFilters">{{ $t('reset') }}</el-button>
            </el-form-item>
          </el-form>

          <el-table v-loading="loading" :data="keys" class="table">
            <el-table-column prop="userId" :label="$t('userId')" width="90"/>
            <el-table-column prop="userEmail" :label="$t('keyOwner')" min-width="190"/>
            <el-table-column prop="name" :label="$t('apiKeyName')" min-width="145"/>
            <el-table-column prop="keyPrefix" label="API Key" min-width="230" show-overflow-tooltip/>
            <el-table-column :label="$t('tabStatus')" width="100">
              <template #default="{row}">
                <el-tag :type="row.status === 0 ? 'success' : 'info'">
                  {{ row.status === 0 ? $t('apiKeyActive') : $t('apiKeyRevokedStatus') }}
                </el-tag>
              </template>
            </el-table-column>
            <el-table-column :label="$t('validUntil')" min-width="165">
              <template #default="{row}">{{ row.expireTime || $t('unlimited') }}</template>
            </el-table-column>
            <el-table-column :label="$t('lastUsedIp')" min-width="135">
              <template #default="{row}">{{ row.lastUsedIp || '-' }}</template>
            </el-table-column>
            <el-table-column :label="$t('apiKeyLastUsedAt')" min-width="170">
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
        </div>
      </div>
    </el-scrollbar>

    <el-dialog v-model="createShow" :title="$t('createApiKey')" width="520">
      <el-form label-position="top">
        <el-form-item :label="$t('apiKeyType')">
          <el-tag :type="activeType === '1' ? 'danger' : ''">
            {{ activeType === '1' ? $t('adminApiKey') : $t('userApiKey') }}
          </el-tag>
        </el-form-item>
        <el-form-item v-if="activeType === '0'" :label="$t('userId')">
          <el-input-number v-model="form.userId" :min="1"/>
        </el-form-item>
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

    <el-dialog v-model="viewShow" :title="$t('details')" width="680">
      <el-descriptions v-if="selected" :column="1" border>
        <el-descriptions-item :label="$t('keyOwner')">
          {{ selected.userEmail }} (ID: {{ selected.userId }})
        </el-descriptions-item>
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
import router from '@/router/index.js'
import {useUserStore} from '@/store/user.js'
import {settingSet} from '@/request/setting.js'
import {
  adminApiKeyList,
  adminApiKeyCreate,
  adminApiKeyUpdate,
  adminApiKeyRevoke
} from '@/request/api-key.js'

const {t} = useI18n()
const userStore = useUserStore()
const activeType = ref('0')
const keys = ref([])
const loading = ref(false)
const saving = ref(false)
const switchLoading = ref(false)
const createShow = ref(false)
const editShow = ref(false)
const viewShow = ref(false)
const generatedShow = ref(false)
const generatedKey = ref('')
const selected = ref(null)
const editTargetId = ref(null)
const settings = reactive({
  restApiEnabled: 1,
  adminRestApiEnabled: 1
})
const filters = reactive({
  userId: '',
  email: '',
  name: '',
  status: ''
})
const form = reactive({
  userId: 1,
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
  if (userStore.user.type !== 0) return
  loading.value = true
  adminApiKeyList({
    ...filters,
    isAdmin: Number(activeType.value)
  }).then(data => {
    keys.value = data.list || []
    Object.assign(settings, data.settings || {})
  }).finally(() => loading.value = false)
}

function resetFilters() {
  Object.assign(filters, {userId: '', email: '', name: '', status: ''})
  load()
}

function saveSwitch(key, value) {
  switchLoading.value = true
  settingSet({[key]: value}).then(() => {
    ElMessage.success(t('saveSuccessMsg'))
    load()
  }).catch(load).finally(() => switchLoading.value = false)
}

function openCreate() {
  Object.assign(form, {
    userId: userStore.user.userId,
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
  adminApiKeyCreate({
    ...form,
    userId: activeType.value === '1' ? userStore.user.userId : form.userId,
    isAdmin: activeType.value === '1'
  }).then(data => {
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
  adminApiKeyUpdate(editTargetId.value, {...editForm}).then(() => {
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
  }).then(() => adminApiKeyRevoke(row.apiKeyId)).then(() => {
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

onMounted(() => {
  if (userStore.user.type !== 0) {
    router.replace({name: 'email'})
    return
  }
  load()
})
</script>

<style scoped lang="scss">
.settings-container {
  height: 100%;
  overflow: hidden;

  .scroll {
    height: 100%;
  }

  .scroll-body {
    padding: 30px;
    display: flex;
    flex-direction: column;
    gap: 20px;

    @media (max-width: 767px) {
      padding: 20px;
    }
  }

  .settings-card {
    background: var(--el-bg-color);
    border: 1px solid var(--el-border-color);
    border-radius: 8px;
    padding: 20px;
  }

  .card-title {
    font-size: 17px;
    font-weight: bold;
    margin-bottom: 18px;
  }

  .card-title-actions {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 12px;
    flex-wrap: wrap;
  }

  .card-content {
    display: flex;
    flex-direction: column;
  }

  .setting-item {
    min-height: 62px;
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 22px;
    padding: 12px 0;
    border-bottom: 1px solid var(--el-border-color-lighter);

    &:last-child {
      border-bottom: 0;
    }
  }

  .description {
    color: var(--regular-text-color);
    font-size: 13px;
    margin-top: 5px;
    max-width: 760px;
  }

  .filters {
    margin: 5px 0 12px;
  }

  .table {
    width: 100%;
  }
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
</style>