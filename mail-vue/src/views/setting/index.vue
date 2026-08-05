<template>
  <div class="box">
    <div class="container">
      <div class="title">{{$t('profile')}}</div>
      <div class="item">
        <div>{{$t('username')}}</div>
        <div>
          <span v-if="setNameShow" class="edit-name-input">
            <el-input v-model="accountName"  ></el-input>
            <span class="edit-name" @click="setName">
             {{$t('save')}}
            </span>
          </span>
          <span v-else class="user-name">
            <span >{{ userStore.user.name }}</span>
            <span class="edit-name" @click="showSetName">
             {{$t('change')}}
            </span>
          </span>
        </div>
      </div>
      <div class="item">
        <div>{{$t('emailAccount')}}</div>
        <div>{{ userStore.user.email }}</div>
      </div>
      <div class="item">
        <div>{{$t('password')}}</div>
        <div>
          <el-button type="primary" @click="pwdShow = true">{{$t('changePwdBtn')}}</el-button>
        </div>
      </div>
    </div>
    <div class="language">
      <div class="title">{{$t('language')}}</div>
      <el-select
          :model-value="langSelect"
          class="language-select"
          placeholder="Select"
          @change="changeLang"
      >
        <el-option label="中文" value="zh" @pointerdown.prevent.stop="changeLang('zh')"/>
        <el-option label="English" value="en" @pointerdown.prevent.stop="changeLang('en')"/>
      </el-select>
    </div>
    <div class="api-key-section">
      <div class="api-key-header">
        <div class="title">{{ $t('apiKeys') }}</div>
        <div class="api-key-actions">
          <el-button @click="openApiDocs">{{ $t('apiDocs') }}</el-button>
          <el-button type="primary" :disabled="!apiEnabled" @click="createKeyShow = true">
            {{ $t('createApiKey') }}
          </el-button>
        </div>
      </div>
      <el-alert
          v-if="!apiEnabled"
          :title="$t('restApiDisabledDesc')"
          type="warning"
          :closable="false"
          show-icon
      />
      <div v-else class="api-key-limit">
        {{ $t('apiKeyLimitDesc', {count: maxActiveKeys}) }}
      </div>
      <div v-loading="apiKeyLoading" class="api-key-list">
        <el-empty v-if="!apiKeyLoading && apiKeys.length === 0" :description="$t('noApiKeys')"/>
        <div v-for="item in apiKeys" :key="item.apiKeyId" class="api-key-item">
          <div class="api-key-main">
            <div class="api-key-name">
              <strong>{{ item.name }}</strong>
              <el-tag :type="item.status === 0 ? 'success' : 'info'" size="small">
                {{ item.status === 0 ? $t('apiKeyActive') : $t('apiKeyRevokedStatus') }}
              </el-tag>
            </div>
            <code>{{ item.keyPrefix }}</code>
            <div class="api-key-meta">
              <span>{{ $t('apiKeyCreatedAt') }}：{{ item.createTime }}</span>
              <span>{{ $t('apiKeyLastUsedAt') }}：{{ item.lastUsedTime || $t('apiKeyNeverUsed') }}</span>
            </div>
          </div>
          <el-button
              v-if="item.status === 0"
              type="danger"
              plain
              :loading="revokingKeyId === item.apiKeyId"
              @click="revokeKey(item)"
          >
            {{ $t('revokeApiKey') }}
          </el-button>
        </div>
      </div>
    </div>
    <div class="del-email" v-perm="'my:delete'">
      <div class="title">{{$t('deleteUser')}}</div>
      <div style="color: var(--regular-text-color);">
        {{$t('delAccountMsg')}}
      </div>
      <div>
        <el-button type="primary" @click="deleteConfirm">{{$t('deleteUserBtn')}}</el-button>
      </div>
    </div>
    <el-dialog
        v-model="createKeyShow"
        :title="$t('createApiKey')"
        width="400"
        @closed="apiKeyName = ''"
    >
      <el-input
          v-model="apiKeyName"
          maxlength="50"
          show-word-limit
          :placeholder="$t('apiKeyNamePlaceholder')"
          @keyup.enter="createKey"
      />
      <template #footer>
        <el-button @click="createKeyShow = false">{{ $t('cancel') }}</el-button>
        <el-button type="primary" :loading="creatingKey" @click="createKey">
          {{ $t('createApiKey') }}
        </el-button>
      </template>
    </el-dialog>
    <el-dialog
        v-model="generatedKeyShow"
        :title="$t('apiKeyOneTimeTitle')"
        width="520"
        :close-on-click-modal="false"
        @closed="generatedKey = ''"
    >
      <el-alert :title="$t('apiKeyOneTimeDesc')" type="warning" :closable="false" show-icon/>
      <el-input v-model="generatedKey" readonly class="generated-key">
        <template #append>
          <el-button @click="copyGeneratedKey">{{ $t('copy') }}</el-button>
        </template>
      </el-input>
    </el-dialog>
    <el-dialog v-model="pwdShow" :title="$t('changePassword')" width="340">
      <div class="update-pwd">
        <el-input type="password" :placeholder="$t('newPassword')" v-model="form.password" autocomplete="off"/>
        <el-input type="password" :placeholder="$t('confirmPassword')" v-model="form.newPwd" autocomplete="off"/>
        <el-button type="primary" :loading="setPwdLoading" @click="submitPwd">{{$t('save')}}</el-button>
      </div>
    </el-dialog>
  </div>
</template>
<script setup>
import {reactive, ref, defineOptions, onMounted} from 'vue'
import {resetPassword, userDelete} from "@/request/my.js";
import {useUserStore} from "@/store/user.js";
import router from "@/router/index.js";
import {accountSetName} from "@/request/account.js";
import {useAccountStore} from "@/store/account.js";
import {useI18n} from "vue-i18n";
import {useSettingStore} from "@/store/setting.js";
import {apiKeyCreate, apiKeyRevoke, apiKeyStatus} from "@/request/api-key.js";

const { t } = useI18n()
const accountStore = useAccountStore()
const settingStore = useSettingStore()
const userStore = useUserStore();
const setPwdLoading = ref(false)
const setNameShow = ref(false)
const accountName = ref(null)
const langSelect = ref(settingStore.lang)
const apiKeys = ref([])
const apiEnabled = ref(false)
const maxActiveKeys = ref(10)
const apiKeyLoading = ref(false)
const createKeyShow = ref(false)
const generatedKeyShow = ref(false)
const apiKeyName = ref('')
const generatedKey = ref('')
const creatingKey = ref(false)
const revokingKeyId = ref(null)

defineOptions({
  name: 'setting'
})

function showSetName() {
  accountName.value = userStore.user.name
  setNameShow.value = true
}

function setName() {

  if (!accountName.value) {
    ElMessage({
      message: t('emptyUserNameMsg'),
      type: 'error',
      plain: true,
    })
    return;
  }

  setNameShow.value = false
  let name = accountName.value

  if (name === userStore.user.name) {
    return
  }

  userStore.user.name = accountName.value

  accountSetName(userStore.user.account.accountId,name).then(() => {
    ElMessage({
      message: t('saveSuccessMsg'),
      type: 'success',
      plain: true,
    })

    accountStore.changeUserAccountName = name

  }).catch(() => {
    userStore.user.name = name
  })
}

function changeLang(lang) {
  let setting = {}
  try {
    setting = JSON.parse(localStorage.getItem('setting') || '{}')
  } catch (e) {
    setting = {}
  }
  localStorage.setItem('setting', JSON.stringify({...setting, lang}))
  window.location.reload()
}

const pwdShow = ref(false)
const form = reactive({
  password: '',
  newPwd: '',
})

function loadApiKeys() {
  apiKeyLoading.value = true
  apiKeyStatus().then(data => {
    apiEnabled.value = data.enabled
    maxActiveKeys.value = data.maxActiveKeys
    apiKeys.value = data.list
  }).finally(() => {
    apiKeyLoading.value = false
  })
}

function createKey() {
  const name = apiKeyName.value.trim()
  if (!name || creatingKey.value) return

  creatingKey.value = true
  apiKeyCreate(name).then(data => {
    generatedKey.value = data.key
    createKeyShow.value = false
    generatedKeyShow.value = true
    ElMessage({
      message: t('apiKeyCreated'),
      type: 'success',
      plain: true
    })
    loadApiKeys()
  }).finally(() => {
    creatingKey.value = false
  })
}

function revokeKey(item) {
  ElMessageBox.confirm(t('revokeApiKeyConfirm'), {
    confirmButtonText: t('confirm'),
    cancelButtonText: t('cancel'),
    type: 'warning'
  }).then(() => {
    revokingKeyId.value = item.apiKeyId
    apiKeyRevoke(item.apiKeyId).then(() => {
      ElMessage({
        message: t('apiKeyRevoked'),
        type: 'success',
        plain: true
      })
      loadApiKeys()
    }).finally(() => {
      revokingKeyId.value = null
    })
  })
}

async function copyGeneratedKey() {
  try {
    await navigator.clipboard.writeText(generatedKey.value)
    ElMessage({
      message: t('apiKeyCopySuccess'),
      type: 'success',
      plain: true
    })
  } catch {
    ElMessage({
      message: t('copyFailMsg'),
      type: 'error',
      plain: true
    })
  }
}

function openApiDocs() {
  window.open('/api-docs.html', '_blank', 'noopener,noreferrer')
}

onMounted(loadApiKeys)

const deleteConfirm = () => {
  ElMessageBox.confirm(t('delAccountConfirm'), {
    confirmButtonText: t('confirm'),
    cancelButtonText: t('cancel'),
    type: 'warning'
  }).then(() => {
    userDelete().then(() => {
      localStorage.removeItem('token');
      router.replace('/login');
      ElMessage({
        message: t('delSuccessMsg'),
        type: 'success',
        plain: true,
      })
    })
  })
}


function submitPwd() {

  if (!form.password) {
    ElMessage({
      message: t('emptyPwdMsg'),
      type: 'error',
      plain: true,
    })
    return
  }

  if (form.password.length < 6) {
    ElMessage({
      message: t('pwdLengthMsg'),
      type: 'error',
      plain: true,
    })
    return
  }

  if (form.password !== form.newPwd) {
    ElMessage({
      message: t('confirmPwdFailMsg'),
      type: 'error',
      plain: true,
    })
    return
  }

  setPwdLoading.value = true
  resetPassword(form.password).then(() => {
    ElMessage({
      message: t('saveSuccessMsg'),
      type: 'success',
      plain: true,
    })
    pwdShow.value = false
    setPwdLoading.value = false
    form.password = ''
    form.newPwd = ''
  }).catch(() => {
    setPwdLoading.value = false
  })

}

</script>
<style scoped lang="scss">
.box {
  padding: 40px 40px;

  @media (max-width: 767px) {
    padding: 30px 30px;
  }

  .update-pwd {
    display: flex;
    flex-direction: column;
    gap: 15px;
  }

  .title {
    font-size: 18px;
    font-weight: bold;
  }

  .container {
    font-size: 14px;
    display: grid;
    gap: 20px;
    margin-bottom: 40px;

    .item {
      display: grid;
      grid-template-columns: 50px 1fr;
      gap: 140px;
      position: relative;
      .user-name {
        display: grid;
        grid-template-columns: auto 1fr;
        span:first-child {
          overflow: hidden;
          white-space: nowrap;
          text-overflow: ellipsis;
        }
      }

      .edit-name-input {
        position: absolute;
        bottom: -6px;
        .el-input {
          width: min(200px,calc(100vw - 222px));
        }
      }

      .edit-name {
        color: #4dabff;
        padding-left: 10px;
        cursor: pointer;
      }

      @media (max-width: 767px) {
        gap: 70px;
      }

      div:first-child {
        font-weight: bold;
      }

      div:last-child {
        overflow: hidden;
        white-space: nowrap;
        text-overflow: ellipsis;
      }
    }
  }

  .language {
    display: flex;
    flex-direction: column;
    gap: 20px;
    margin-bottom: 40px;

    .language-select {
      width: 100px;
    }
  }

  .api-key-section {
    display: flex;
    flex-direction: column;
    gap: 16px;
    margin-bottom: 40px;

    .api-key-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      flex-wrap: wrap;
    }

    .api-key-actions {
      display: flex;
      gap: 10px;
    }

    .api-key-limit {
      color: var(--regular-text-color);
      font-size: 13px;
    }

    .api-key-list {
      min-height: 80px;
      display: flex;
      flex-direction: column;
      gap: 12px;
    }

    .api-key-item {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      padding: 14px;
      border: 1px solid var(--el-border-color);
      border-radius: 8px;

      @media (max-width: 767px) {
        align-items: stretch;
        flex-direction: column;
      }
    }

    .api-key-main {
      min-width: 0;
      display: flex;
      flex-direction: column;
      gap: 8px;

      code {
        overflow-wrap: anywhere;
      }
    }

    .api-key-name {
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .api-key-meta {
      display: flex;
      flex-wrap: wrap;
      gap: 6px 18px;
      color: var(--regular-text-color);
      font-size: 12px;
    }
  }

  .generated-key {
    margin-top: 16px;
  }

  .del-email {
    font-size: 14px;
    display: flex;
    flex-direction: column;
    gap: 20px;
  }
}
</style>
