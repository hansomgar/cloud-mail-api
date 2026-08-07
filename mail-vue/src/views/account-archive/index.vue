<template>
  <div class="archive-page">
    <div class="header">
      <div>
        <h2>{{ $t('archivedAccounts') }}</h2>
        <div class="description">{{ $t(adminMode ? 'adminArchivedAccountsDesc' : 'archivedAccountsDesc') }}</div>
      </div>
      <el-button
          type="danger"
          :disabled="!selected.length || !canDelete"
          :loading="deleting"
          @click="removeSelected"
      >
        {{ $t('permanentDeleteSelected') }}
      </el-button>
    </div>

    <el-alert
        :title="$t('permanentDeleteArchiveWarning')"
        type="warning"
        :closable="false"
        show-icon
    />

    <el-form inline class="filters">
      <el-form-item :label="$t('archiveType')">
        <el-select v-model="filters.archiveType" clearable style="width: 150px">
          <el-option :label="$t('deletedAccountArchive')" value="deleted"/>
          <el-option :label="$t('renamedAccountArchive')" value="renamed"/>
        </el-select>
      </el-form-item>
      <el-form-item :label="$t('emailAccount')">
        <el-input v-model="filters.email" clearable/>
      </el-form-item>
      <template v-if="adminMode">
        <el-form-item :label="$t('userId')">
          <el-input v-model="filters.userId" clearable/>
        </el-form-item>
        <el-form-item :label="$t('primaryEmail')">
          <el-input v-model="filters.userEmail" clearable/>
        </el-form-item>
      </template>
      <el-form-item>
        <el-button type="primary" @click="search">{{ $t('searchUser') }}</el-button>
        <el-button @click="reset">{{ $t('reset') }}</el-button>
      </el-form-item>
    </el-form>

    <el-table
        v-loading="loading"
        :data="items"
        @selection-change="selected = $event"
    >
      <el-table-column type="selection" width="45" :selectable="() => canDelete"/>
      <el-table-column :label="$t('archiveType')" width="130">
        <template #default="{row}">
          <el-tag :type="row.archiveType === 'deleted' ? 'danger' : 'warning'">
            {{ $t(row.archiveType === 'deleted' ? 'deletedAccountArchive' : 'renamedAccountArchive') }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column v-if="adminMode" prop="userId" :label="$t('userId')" width="90"/>
      <el-table-column v-if="adminMode" prop="primaryEmail" :label="$t('primaryEmail')" min-width="200"/>
      <el-table-column prop="email" :label="$t('archivedEmail')" min-width="210"/>
      <el-table-column prop="name" :label="$t('originalAccountName')" min-width="145"/>
      <el-table-column prop="currentEmail" :label="$t('linkedCurrentEmail')" min-width="210">
        <template #default="{row}">{{ row.currentEmail || '-' }}</template>
      </el-table-column>
      <el-table-column prop="archiveTime" :label="$t('archiveTime')" min-width="170"/>
      <el-table-column :label="$t('action')" width="130" fixed="right">
        <template #default="{row}">
          <el-button
              type="danger"
              size="small"
              :disabled="!canDelete"
              @click="remove([row])"
          >
            {{ $t('permanentDelete') }}
          </el-button>
        </template>
      </el-table-column>
      <template #empty>
        <el-empty :description="$t('noArchivedAccounts')"/>
      </template>
    </el-table>

    <div class="pagination">
      <el-pagination
          v-model:current-page="page"
          v-model:page-size="pageSize"
          layout="total, prev, pager, next"
          :total="total"
          @current-change="load"
      />
    </div>
  </div>
</template>

<script setup>
import {computed, onMounted, reactive, ref} from 'vue'
import {useI18n} from 'vue-i18n'
import {hasPerm} from '@/perm/perm.js'
import {
  accountArchiveList,
  accountArchiveDelete,
  adminAccountArchiveList,
  adminAccountArchiveDelete
} from '@/request/account-archive.js'

const props = defineProps({
  adminMode: {
    type: Boolean,
    default: false
  }
})

const {t} = useI18n()
const loading = ref(false)
const deleting = ref(false)
const items = ref([])
const selected = ref([])
const total = ref(0)
const page = ref(1)
const pageSize = ref(20)
const filters = reactive({
  archiveType: '',
  email: '',
  userId: '',
  userEmail: ''
})
const canDelete = computed(() => hasPerm(props.adminMode ? 'all-email:delete' : 'account:delete'))

function params() {
  const data = {
    archiveType: filters.archiveType,
    email: filters.email,
    limit: pageSize.value,
    cursor: (page.value - 1) * pageSize.value
  }
  if (props.adminMode) {
    data.userId = filters.userId
    data.userEmail = filters.userEmail
  }
  return data
}

function load() {
  loading.value = true
  const request = props.adminMode ? adminAccountArchiveList : accountArchiveList
  request(params()).then(data => {
    items.value = data.items || []
    total.value = data.total || 0
    selected.value = []
  }).finally(() => loading.value = false)
}

function search() {
  page.value = 1
  load()
}

function reset() {
  Object.assign(filters, {
    archiveType: '',
    email: '',
    userId: '',
    userEmail: ''
  })
  search()
}

function removeSelected() {
  remove(selected.value)
}

function remove(rows) {
  if (!rows.length || deleting.value) return
  ElMessageBox.confirm(
      t('permanentDeleteArchiveConfirm', {count: rows.length}),
      t('warning'),
      {
        confirmButtonText: t('confirm'),
        cancelButtonText: t('cancel'),
        type: 'warning'
      }
  ).then(() => {
    deleting.value = true
    const request = props.adminMode
      ? adminAccountArchiveDelete
      : accountArchiveDelete
    return request(rows.map(row => ({
      archiveType: row.archiveType,
      archiveId: row.archiveId
    })))
  }).then(data => {
    ElMessage.success(t('permanentDeleteSuccess', {count: data.deleted}))
    if (items.value.length === rows.length && page.value > 1) page.value -= 1
    load()
  }).finally(() => deleting.value = false)
}

onMounted(load)
</script>

<style scoped lang="scss">
.archive-page {
  padding: 30px;
  display: flex;
  flex-direction: column;
  gap: 18px;

  @media (max-width: 767px) {
    padding: 20px;
  }
}

.header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 15px;
  flex-wrap: wrap;

  h2 {
    margin: 0;
    font-size: 20px;
  }
}

.description {
  color: var(--regular-text-color);
  font-size: 13px;
  margin-top: 5px;
}

.filters {
  margin-bottom: -8px;
}

.pagination {
  display: flex;
  justify-content: flex-end;
}
</style>