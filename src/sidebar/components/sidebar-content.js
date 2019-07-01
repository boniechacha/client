'use strict';

const events = require('../events');
const isThirdPartyService = require('../util/is-third-party-service');
const tabs = require('../tabs');

// @ngInject
function SidebarContentController(
  $scope,
  analytics,
  annotations,
  store,
  frameSync,
  rootThread,
  settings,
  streamer
) {
  const self = this;

  function thread() {
    return rootThread.thread(store.getState());
  }

  const unsubscribeAnnotationUI = store.subscribe(function() {
    const state = store.getState();

    self.rootThread = thread();
    self.selectedTab = state.selectedTab;

    const counts = tabs.counts(state.annotations);

    Object.assign(self, {
      totalNotes: counts.notes,
      totalAnnotations: counts.annotations,
      totalOrphans: counts.orphans,
      waitingToAnchorAnnotations: counts.anchoring > 0,
    });
  });

  $scope.$on('$destroy', unsubscribeAnnotationUI);

  function focusAnnotation(annotation) {
    let highlights = [];
    if (annotation) {
      highlights = [annotation.$tag];
    }
    frameSync.focusAnnotations(highlights);
  }

  function scrollToAnnotation(annotation) {
    if (!annotation) {
      return;
    }
    frameSync.scrollToAnnotation(annotation.$tag);
  }

  /**
   * Returns the Annotation object for the first annotation in the
   * selected annotation set. Note that 'first' refers to the order
   * of annotations passed to store when selecting annotations,
   * not the order in which they appear in the document.
   */
  function firstSelectedAnnotation() {
    if (store.getState().selectedAnnotationMap) {
      const id = Object.keys(store.getState().selectedAnnotationMap)[0];
      return store.getState().annotations.find(function(annot) {
        return annot.id === id;
      });
    } else {
      return null;
    }
  }

  $scope.$on('sidebarOpened', function() {
    analytics.track(analytics.events.SIDEBAR_OPENED);

    streamer.connect();
  });

  this.$onInit = () => {
    // If the user is logged in, we connect nevertheless
    if (this.auth.status === 'logged-in') {
      streamer.connect();
    }
  };

  $scope.$on(events.USER_CHANGED, function() {
    streamer.reconnect();
  });

  $scope.$on(events.ANNOTATIONS_SYNCED, function(event, tags) {
    // When a direct-linked annotation is successfully anchored in the page,
    // focus and scroll to it
    const selectedAnnot = firstSelectedAnnotation();
    if (!selectedAnnot) {
      return;
    }
    const matchesSelection = tags.some(function(tag) {
      return tag === selectedAnnot.$tag;
    });
    if (!matchesSelection) {
      return;
    }
    focusAnnotation(selectedAnnot);
    scrollToAnnotation(selectedAnnot);

    store.selectTab(tabs.tabForAnnotation(selectedAnnot));
  });

  // Re-fetch annotations when focused group, logged-in user or connected frames
  // change.
  $scope.$watch(
    () => [
      store.getState().focusedGroupId,
      store.profile().userid,
      ...store.searchUris(),
    ],
    ([currentGroupId], [prevGroupId]) => {
      if (!currentGroupId) {
        // When switching accounts, groups are cleared and so the focused group id
        // will be null for a brief period of time.
        store.clearSelectedAnnotations();
        return;
      }

      if (!prevGroupId || currentGroupId !== prevGroupId) {
        // The focused group may be changed during loading annotations as a result
        // of switching to the group containing a direct-linked annotation.
        //
        // In that case, we don't want to trigger reloading annotations again.
        if (store.isFetchingAnnotations()) {
          return;
        }
        store.clearSelectedAnnotations();
      }

      const searchUris = store.searchUris();
      const groupId = currentGroupId;
      annotations.load(searchUris, groupId);
    },
    true
  );

  this.showSelectedTabs = function() {
    if (
      this.selectedAnnotationUnavailable() ||
      this.selectedGroupUnavailable() ||
      store.getState().filterQuery
    ) {
      return false;
    }
    return true;
  };

  this.setCollapsed = function(id, collapsed) {
    store.setCollapsed(id, collapsed);
  };

  this.focus = focusAnnotation;
  this.scrollTo = scrollToAnnotation;

  this.selectedGroupUnavailable = function() {
    return (
      !store.isFetchingAnnotations() &&
      store.getState().directLinkedGroupFetchFailed
    );
  };

  this.selectedAnnotationUnavailable = function() {
    const selectedID = store.getFirstSelectedAnnotationId();
    return (
      !store.isFetchingAnnotations() &&
      !!selectedID &&
      !store.annotationExists(selectedID)
    );
  };

  this.shouldShowLoggedOutMessage = function() {
    // If user is not logged out, don't show CTA.
    if (self.auth.status !== 'logged-out') {
      return false;
    }

    // If user has not landed on a direct linked annotation
    // don't show the CTA.
    if (!store.getState().directLinkedAnnotationId) {
      return false;
    }

    // The CTA text and links are only applicable when using Hypothesis
    // accounts.
    if (isThirdPartyService(settings)) {
      return false;
    }

    // The user is logged out and has landed on a direct linked
    // annotation. If there is an annotation selection and that
    // selection is available to the user, show the CTA.
    const selectedID = store.getFirstSelectedAnnotationId();
    return (
      !store.isFetchingAnnotations() &&
      !!selectedID &&
      store.annotationExists(selectedID)
    );
  };
}

module.exports = {
  controller: SidebarContentController,
  controllerAs: 'vm',
  bindings: {
    auth: '<',
    onLogin: '&',
  },
  template: require('../templates/sidebar-content.html'),
};
