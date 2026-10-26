/* 无模型调用；页面可见时只更新记录，未变化则不重新渲染。 */
function createRecordSync({active, load, current, update}) {
  let busy=false;
  return async function sync() {
    if(busy || !active())return 'inactive';
    busy=true;
    try {
      const rows=await load();
      if(!Array.isArray(rows))throw Error('记录格式无效');
      if(JSON.stringify(rows)===JSON.stringify(current()))return 'unchanged';
      update(rows);return 'updated';
    } catch {return 'retry_later'} finally {busy=false}
  };
}
if(typeof module!=='undefined')module.exports={createRecordSync};
